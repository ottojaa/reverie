import { sql, type Kysely } from 'kysely';
import type { Database, TaughtLabel } from '../db/schema';
import { rebuildSearchVectors } from '../tools/write';
import { computeInitialThreshold, findCandidates } from './matching';
import { loadLiveExampleIds, updateThreshold } from './taught-labels.repository';

/**
 * Putting a label's taught tags on the library. A taught tag is a `document_tags` row with `source = 'taught'`.
 *
 * Receivers are the owner's live images, private folders included: a private image gets the tag so it can be found
 * once its folder is open, and every read path already hides private and trashed documents. Trashed images are
 * never touched. An existing `user` tag is left alone; an existing `auto` tag becomes `taught`, because an LLM
 * reprocess deletes `auto` tags and the label would otherwise silently drop off the image.
 */

type Conn = Kysely<Database>;

const WRITE_CHUNK = 5000;

function chunk<T>(items: T[]): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < items.length; i += WRITE_CHUNK) chunks.push(items.slice(i, i + WRITE_CHUNK));

    return chunks;
}

/** Tags the documents with the label; returns the ids whose tag row was created or converted. */
export async function addTaughtTags(conn: Conn, label: TaughtLabel, documentIds: string[]): Promise<string[]> {
    const changed: string[] = [];

    for (const ids of chunk(documentIds)) {
        const rows = await conn
            .insertInto('document_tags')
            .values(ids.map((document_id) => ({ document_id, tag: label.name, source: 'taught' as const })))
            .onConflict((oc) => oc.columns(['document_id', 'tag']).doUpdateSet({ source: 'taught' }).where('document_tags.source', '=', 'auto'))
            .returning('document_id')
            .execute();

        changed.push(...rows.map((row) => row.document_id));
    }

    await rebuildSearchVectors(conn, changed);

    return changed;
}

/** Deletes the label's taught tag from these documents. */
async function removeTaughtTags(conn: Conn, label: TaughtLabel, documentIds: string[]): Promise<void> {
    for (const ids of chunk(documentIds)) {
        await conn
            .deleteFrom('document_tags')
            .where('tag', '=', label.name)
            .where('source', '=', 'taught')
            .where(sql<boolean>`document_id = ANY(${ids}::uuid[])`)
            .execute();
    }

    await rebuildSearchVectors(conn, documentIds);
}

/**
 * Taught tags of this label on documents that no longer qualify. Only documents with a vector from a model the
 * examples also have are judged, so switching the embedding model doesn't strip every label before the library is
 * embedded again. A label with no examples left qualifies nothing.
 */
async function loadStaleTaggedIds(conn: Conn, label: TaughtLabel, keep: Set<string>, hasExamples: boolean): Promise<string[]> {
    const comparable = sql<boolean>`EXISTS (
        SELECT 1 FROM document_image_embeddings e
        JOIN document_image_embeddings x ON x.model = e.model AND x.model_version = e.model_version
        JOIN taught_label_examples ex ON ex.document_id = x.document_id AND ex.label_id = ${label.id}
        WHERE e.document_id = t.document_id
    )`;
    let query = conn
        .selectFrom('document_tags as t')
        .innerJoin('documents as d', 'd.id', 't.document_id')
        .select('t.document_id')
        .where('t.tag', '=', label.name)
        .where('t.source', '=', 'taught')
        .where('d.user_id', '=', label.user_id)
        .where('d.deleted_at', 'is', null);

    if (hasExamples) query = query.where(comparable);

    return (await query.execute()).map((row) => row.document_id).filter((id) => !keep.has(id));
}

export interface ReconcileResult {
    added: number;
    removed: number;
}

/**
 * Brings the library in line with the label: every example and every image reaching the threshold has the tag,
 * and images that no longer qualify lose it. The exclusion list keeps removed images from coming back.
 */
export async function reconcileLabel(conn: Conn, label: TaughtLabel): Promise<ReconcileResult> {
    const exampleIds = await loadLiveExampleIds(conn, label.id);
    const matches = await findCandidates(conn, label, { minSimilarity: label.threshold });
    const target = new Set([...exampleIds, ...matches.map((match) => match.documentId)]);
    const added = await addTaughtTags(conn, label, [...target]);
    const stale = await loadStaleTaggedIds(conn, label, target, exampleIds.length > 0);

    await removeTaughtTags(conn, label, stale);

    return { added: added.length, removed: stale.length };
}

/** Recomputes a threshold that still follows the examples (the user hasn't moved it); returns the label as it stands. */
export async function refreshThreshold(conn: Conn, label: TaughtLabel): Promise<TaughtLabel> {
    if (label.threshold_is_custom) return label;

    const threshold = await computeInitialThreshold(conn, label.id);

    await updateThreshold(conn, label.id, threshold, false);

    return { ...label, threshold };
}

/** Deletes every taught tag the label put on the owner's images. */
export async function removeAllTaughtTags(conn: Conn, label: TaughtLabel): Promise<void> {
    const rows = await conn
        .deleteFrom('document_tags')
        .where('tag', '=', label.name)
        .where('source', '=', 'taught')
        .where(({ exists, selectFrom }) =>
            exists(selectFrom('documents as d').select('d.id').whereRef('d.id', '=', 'document_tags.document_id').where('d.user_id', '=', label.user_id)),
        )
        .returning('document_id')
        .execute();

    await rebuildSearchVectors(
        conn,
        rows.map((row) => row.document_id),
    );
}

interface LabelSimilarity {
    label: TaughtLabel;
    similarity: number;
    isExample: boolean;
}

/** Each of the owner's labels with this image's best similarity to its examples (labels with no comparable example are missing). */
async function loadLabelSimilarities(conn: Conn, userId: string, documentId: string): Promise<LabelSimilarity[]> {
    const rows = await conn
        .selectFrom('taught_labels as l')
        .innerJoin('taught_label_examples as ex', 'ex.label_id', 'l.id')
        .innerJoin('documents as xd', 'xd.id', 'ex.document_id')
        .innerJoin('document_image_embeddings as x', 'x.document_id', 'ex.document_id')
        .innerJoin('document_image_embeddings as e', (join) => join.onRef('e.model', '=', 'x.model').onRef('e.model_version', '=', 'x.model_version'))
        .selectAll('l')
        .select([sql<number>`max(1 - (e.embedding <=> x.embedding))`.as('similarity'), sql<boolean>`bool_or(ex.document_id = ${documentId})`.as('is_example')])
        .where('l.user_id', '=', userId)
        .where('e.document_id', '=', documentId)
        .where('xd.deleted_at', 'is', null)
        .groupBy('l.id')
        .execute();

    return rows.map(({ similarity, is_example, ...label }) => ({ label, similarity: Number(similarity), isExample: is_example }));
}

/**
 * Called once an image's embedding is stored. A label this image is an example of is reconciled over the whole
 * library (its look is new information); for any other label the image is only added when it matches. Trashed
 * images and images on a label's exclusion list are left alone.
 */
export async function propagateForDocument(conn: Conn, documentId: string): Promise<void> {
    const doc = await conn.selectFrom('documents').select(['user_id', 'deleted_at']).where('id', '=', documentId).executeTakeFirst();

    if (!doc || doc.deleted_at) return;

    const similarities = await loadLabelSimilarities(conn, doc.user_id, documentId);

    if (similarities.length === 0) return;

    const excluded = await conn.selectFrom('taught_label_exclusions').select('label_id').where('document_id', '=', documentId).execute();
    const excludedLabels = new Set(excluded.map((row) => row.label_id));

    for (const { label, similarity, isExample } of similarities) {
        if (isExample) {
            await reconcileLabel(conn, await refreshThreshold(conn, label));
            continue;
        }

        if (excludedLabels.has(label.id) || similarity < label.threshold) continue;

        await addTaughtTags(conn, label, [documentId]);
    }
}
