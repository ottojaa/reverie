import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { ModelRef } from '../embeddings/embedding.repository';
import { toCameraFacts, type KindFacts, type KindVerdict } from './classifier';
import { KIND_CLASSIFIER, type KindClassifierConfig } from './classifier-config';
import { hasSeedSet } from './seed-set.repository';
import type { ImageKind } from './kinds';

export interface KindInputs {
    embedding: number[];
    model: ModelRef;
    facts: KindFacts;
}

export interface StoredKind {
    kind: ImageKind;
    scores: Record<string, number>;
    signals: Record<string, unknown>;
    promptVersion: string;
    model: ModelRef;
}

function isCoordinate(value: number | null): boolean {
    return value !== null && Number.isFinite(Number(value));
}

/** What the classifier needs about an image document: its stored embedding, EXIF camera facts and size. Null when it has no embedding. */
export async function loadKindInputs(db: Kysely<Database>, documentId: string): Promise<KindInputs | null> {
    const row = await db
        .selectFrom('documents as d')
        .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
        .select([
            sql<string>`e.embedding::text`.as('embedding'),
            'e.model',
            'e.model_version',
            'd.width',
            'd.height',
            'pm.camera_make',
            'pm.camera_model',
            'pm.lens_model',
            'pm.latitude',
            'pm.longitude',
            'pm.taken_at',
        ])
        .where('d.id', '=', documentId)
        .where('d.mime_type', 'like', 'image/%')
        .executeTakeFirst();

    if (!row) return null;

    const camera = toCameraFacts({
        make: Boolean(row.camera_make),
        model: Boolean(row.camera_model),
        lens: Boolean(row.lens_model),
        gps: isCoordinate(row.latitude) && isCoordinate(row.longitude),
    });

    return {
        embedding: JSON.parse(row.embedding) as number[],
        model: { model: row.model, version: row.model_version },
        facts: { camera, captureDate: row.taken_at !== null, width: row.width, height: row.height },
    };
}

export async function loadStoredKind(db: Kysely<Database>, documentId: string): Promise<StoredKind | null> {
    const row = await db.selectFrom('document_image_kinds').selectAll().where('document_id', '=', documentId).executeTakeFirst();

    if (!row) return null;

    return {
        kind: row.kind as ImageKind,
        scores: row.scores,
        signals: row.signals,
        promptVersion: row.prompt_version,
        model: { model: row.model, version: row.model_version },
    };
}

export async function upsertKind(
    db: Kysely<Database>,
    documentId: string,
    verdict: KindVerdict,
    model: ModelRef,
    config: KindClassifierConfig = KIND_CLASSIFIER,
): Promise<void> {
    const values = {
        kind: verdict.kind,
        scores: JSON.stringify(verdict.scores),
        signals: JSON.stringify(verdict.signals),
        prompt_version: config.version,
        model: model.model,
        model_version: model.version,
        classified_at: new Date(),
    };

    await db
        .insertInto('document_image_kinds')
        .values({ document_id: documentId, ...values })
        .onConflict((oc) => oc.column('document_id').doUpdateSet(values))
        .execute();
}

/**
 * Live images with an embedding from the current image model and no verdict from the current classifier version for
 * that embedding, in id order after `after`. Images without an embedding are the image stage's job. A version that
 * scores by seeds finds nothing until its seed set exists for this image model: there is nothing to classify with.
 */
export async function findDocumentsMissingKind(
    db: Kysely<Database>,
    current: ModelRef,
    after: string | null,
    limit: number,
    config: KindClassifierConfig = KIND_CLASSIFIER,
): Promise<string[]> {
    if (config.prototypes && !(await hasSeedSet(db, config.version, current))) return [];

    const rows = await db
        .selectFrom('documents as d')
        .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
        .leftJoin('document_image_kinds as k', 'k.document_id', 'd.id')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .where('d.mime_type', 'like', 'image/%')
        .where('e.model', '=', current.model)
        .where('e.model_version', '=', current.version)
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .where((eb) =>
            eb.or([
                eb('k.document_id', 'is', null),
                eb('k.prompt_version', '<>', config.version),
                eb('k.model', '<>', current.model),
                eb('k.model_version', '<>', current.version),
            ]),
        )
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}
