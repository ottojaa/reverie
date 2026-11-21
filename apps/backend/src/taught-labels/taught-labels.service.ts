import { NotFoundError, ValidationError, type TaughtLabel as TaughtLabelDto } from '@reverie/shared';
import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, TaughtLabel } from '../db/schema';
import { sanitizeTag } from '../llm/tag-sanitizer';
import { rebuildSearchVectors } from '../tools/write';
import { DEFAULT_THRESHOLD, MIN_THRESHOLD, findCandidates, roundThreshold } from './matching';
import { reconcileLabel, refreshThreshold, removeAllTaughtTags } from './propagation';
import {
    addExamples,
    addExclusions,
    countVisible,
    insertLabel,
    loadLabel,
    loadLabelByName,
    loadLabels,
    loadOwnedImageIds,
    loadVisibleMatchIds,
    removeExample,
    updateThreshold,
} from './taught-labels.repository';

type Conn = Kysely<Database>;

/** How many similarities the manager gets for its live count; past this the lowest ones are cut. */
export const SIMILARITIES_CAP = 5000;

export async function toLabelDtos(conn: Conn, userId: string, labels: TaughtLabel[], privateFolderIds: string[]): Promise<TaughtLabelDto[]> {
    const counts = await countVisible(conn, userId, privateFolderIds);

    return labels.map((label) => ({
        id: label.id,
        name: label.name,
        threshold: label.threshold,
        threshold_is_custom: label.threshold_is_custom,
        example_count: counts.get(label.id)?.examples ?? 0,
        match_count: counts.get(label.id)?.matches ?? 0,
        created_at: label.created_at.toISOString(),
        updated_at: label.updated_at.toISOString(),
    }));
}

export async function listLabels(userId: string, privateFolderIds: string[]): Promise<TaughtLabelDto[]> {
    return toLabelDtos(db, userId, await loadLabels(db, userId), privateFolderIds);
}

export async function fetchLabel(userId: string, labelId: string): Promise<TaughtLabel> {
    const label = await loadLabel(db, userId, labelId);

    if (!label) throw new NotFoundError('Taught label', labelId);

    return label;
}

function toLabelName(raw: string): string {
    const name = sanitizeTag(raw)?.toLowerCase();

    if (!name) throw new ValidationError('Invalid label name: ' + raw);

    return name;
}

export interface TeachResult {
    label: TaughtLabel;
    added: number;
    skipped: number;
}

/**
 * Makes the images examples of the label (creating it when the name is new), then applies it to the library.
 * Documents that aren't the owner's live images can't teach a label and are counted as skipped.
 */
export async function teachLabel(userId: string, rawName: string, documentIds: string[]): Promise<TeachResult> {
    const name = toLabelName(rawName);

    return db.transaction().execute(async (trx) => {
        const ids = await loadOwnedImageIds(trx, userId, Array.from(new Set(documentIds)));

        if (ids.length === 0) throw new ValidationError('None of the selected documents is an image');

        const existing = await loadLabelByName(trx, userId, name);
        const label = existing ?? (await insertLabel(trx, userId, name, DEFAULT_THRESHOLD));
        const added = await addExamples(trx, label.id, ids);
        const refreshed = await refreshThreshold(trx, label);

        await reconcileLabel(trx, refreshed);

        return { label: refreshed, added, skipped: new Set(documentIds).size - ids.length };
    });
}

export async function addLabelExamples(userId: string, labelId: string, documentIds: string[]): Promise<TeachResult> {
    const label = await fetchLabel(userId, labelId);

    return teachLabel(userId, label.name, documentIds);
}

/** Drops an example from its label; the label is re-applied without it. */
export async function removeLabelExample(userId: string, labelId: string, documentId: string): Promise<TaughtLabel> {
    return db.transaction().execute(async (trx) => {
        const label = await loadLabel(trx, userId, labelId);

        if (!label) throw new NotFoundError('Taught label', labelId);

        if (!(await removeExample(trx, labelId, documentId))) throw new NotFoundError('Example', documentId);

        const refreshed = await refreshThreshold(trx, label);

        await reconcileLabel(trx, refreshed);

        return refreshed;
    });
}

export async function setLabelThreshold(userId: string, labelId: string, threshold: number): Promise<TaughtLabel> {
    return db.transaction().execute(async (trx) => {
        const label = await loadLabel(trx, userId, labelId);

        if (!label) throw new NotFoundError('Taught label', labelId);

        const next = { ...label, threshold: Math.max(MIN_THRESHOLD, roundThreshold(threshold)), threshold_is_custom: true };

        await updateThreshold(trx, labelId, next.threshold, true);
        await reconcileLabel(trx, next);

        return next;
    });
}

/**
 * The owner removed the label from this image (the x on its chip in the web app): the taught tag goes, the image
 * joins the exclusion list so no later pass puts it back, and an example is also dropped from the label's examples.
 */
export async function removeLabelMatch(userId: string, labelId: string, documentId: string): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const label = await loadLabel(trx, userId, labelId);

        if (!label) throw new NotFoundError('Taught label', labelId);

        const owned = await trx.selectFrom('documents').select('id').where('id', '=', documentId).where('user_id', '=', userId).executeTakeFirst();

        if (!owned) throw new NotFoundError('Document', documentId);

        await trx.deleteFrom('document_tags').where('document_id', '=', documentId).where('tag', '=', label.name).execute();
        await addExclusions(trx, [{ label_id: labelId, document_id: documentId }]);

        const wasExample = await removeExample(trx, labelId, documentId);

        await rebuildSearchVectors(trx, [documentId]);
        await reconcileLabel(trx, wasExample ? await refreshThreshold(trx, label) : label);
    });
}

export async function deleteLabel(userId: string, labelId: string): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const label = await loadLabel(trx, userId, labelId);

        if (!label) throw new NotFoundError('Taught label', labelId);

        await removeAllTaughtTags(trx, label);
        await trx.deleteFrom('taught_labels').where('id', '=', labelId).execute();
    });
}

export interface LabelMembers {
    exampleIds: string[];
    matchIds: string[];
    matchTotal: number;
}

/** The examples and a page of current matches the owner can see (live, outside private folders). */
export async function loadLabelMembers(label: TaughtLabel, privateFolderIds: string[], page: { limit: number; offset: number }): Promise<LabelMembers> {
    const exampleRows = await db
        .selectFrom('taught_label_examples as ex')
        .innerJoin('documents as d', 'd.id', 'ex.document_id')
        .select('ex.document_id')
        .where('ex.label_id', '=', label.id)
        .where('d.deleted_at', 'is', null)
        .orderBy('ex.created_at')
        .orderBy('ex.document_id')
        .execute();
    const visibleIds = new Set(
        await visibleAmong(
            label.user_id,
            exampleRows.map((row) => row.document_id),
            privateFolderIds,
        ),
    );
    const matches = await loadVisibleMatchIds(db, label, privateFolderIds);

    return {
        exampleIds: exampleRows.map((row) => row.document_id).filter((id) => visibleIds.has(id)),
        matchIds: matches.slice(page.offset, page.offset + page.limit),
        matchTotal: matches.length,
    };
}

async function visibleAmong(userId: string, ids: string[], privateFolderIds: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const rows = await db.selectFrom('documents').select(['id', 'folder_id']).where('user_id', '=', userId).where('id', 'in', ids).execute();
    const hidden = new Set(privateFolderIds);

    return rows.filter((row) => row.folder_id === null || !hidden.has(row.folder_id)).map((row) => row.id);
}

/** Best similarity of every image the label could still match (visible, not excluded, not an example), most similar first. */
export async function loadSimilarities(label: TaughtLabel, privateFolderIds: string[]): Promise<{ similarities: number[]; floor: number; truncated: boolean }> {
    const candidates = await findCandidates(db, label, {
        minSimilarity: MIN_THRESHOLD,
        excludeExamples: true,
        hidePrivateFolders: privateFolderIds,
        limit: SIMILARITIES_CAP + 1,
    });
    const truncated = candidates.length > SIMILARITIES_CAP;
    const kept = candidates.slice(0, SIMILARITIES_CAP).map((candidate) => candidate.similarity);

    return { similarities: kept, floor: truncated ? kept[kept.length - 1]! : MIN_THRESHOLD, truncated };
}
