import type { EmbeddingStatusResponse } from '@reverie/shared';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { BACKFILL_JOB_ID, getEmbedQueue } from '../queues/embed.queue';
import type { ModelRef } from './embedding.repository';
import { MlUnavailableError, type MlClient, type MlHealth } from './ml.client';

type MlStatus = EmbeddingStatusResponse['ml'];

const OFF_ML: MlStatus = { ready: false, reachable: false, device: null, error: null, text: null, image: null };

/** What the ML service says about itself; unreachable is a state to show, not an error. */
export async function loadMlStatus(ml: MlClient | null): Promise<MlStatus> {
    if (!ml) return OFF_ML;

    let health: MlHealth;

    try {
        health = await ml.health();
    } catch (error) {
        if (!(error instanceof MlUnavailableError)) throw error;

        return { ...OFF_ML, error: 'unreachable' };
    }

    return {
        ready: health.ready,
        reachable: true,
        device: health.device,
        error: health.error ?? null,
        text: health.models.text ?? null,
        image: health.models.image ?? null,
    };
}

const toCount = (value: string | number | bigint): number => Number(value);

/** Eligible vs embedded documents per kind. `current` null (ML not up) counts embeddings of any model. */
export async function countEmbeddings(
    db: Kysely<Database>,
    current: { text: ModelRef | null; image: ModelRef | null },
): Promise<Pick<EmbeddingStatusResponse, 'text' | 'image'>> {
    const textModel = current.text ? sql`AND e.model = ${current.text.model} AND e.model_version = ${current.text.version}` : sql``;
    const imageModel = current.image ? sql`AND e.model = ${current.image.model} AND e.model_version = ${current.image.version}` : sql``;
    const { rows } = await sql<{ text_eligible: string; text_embedded: string; image_eligible: string; image_embedded: string }>`
        SELECT
            count(*) FILTER (WHERE has_text) AS text_eligible,
            count(*) FILTER (WHERE has_text AND text_done) AS text_embedded,
            count(*) FILTER (WHERE is_image) AS image_eligible,
            count(*) FILTER (WHERE is_image AND image_done) AS image_embedded
        FROM (
            SELECT
                (EXISTS (SELECT 1 FROM ocr_results o WHERE o.document_id = d.id AND btrim(o.raw_text) <> '')
                 OR EXISTS (SELECT 1 FROM llm_results l WHERE l.document_id = d.id AND btrim(coalesce(l.summary, '')) <> '')) AS has_text,
                EXISTS (SELECT 1 FROM document_text_embeddings e WHERE e.document_id = d.id ${textModel}) AS text_done,
                (d.mime_type LIKE 'image/%' AND d.thumbnail_paths IS NOT NULL) AS is_image,
                EXISTS (SELECT 1 FROM document_image_embeddings e WHERE e.document_id = d.id ${imageModel}) AS image_done
            FROM documents d
            WHERE d.deleted_at IS NULL
        ) x
    `.execute(db);
    const row = rows[0]!;

    return {
        text: { eligible: toCount(row.text_eligible), embedded: toCount(row.text_embedded) },
        image: { eligible: toCount(row.image_eligible), embedded: toCount(row.image_embedded) },
    };
}

export async function loadQueueStatus(): Promise<Pick<EmbeddingStatusResponse, 'queue' | 'backfill'>> {
    const queue = getEmbedQueue();
    const [counts, backfill] = await Promise.all([queue.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed'), queue.getJob(BACKFILL_JOB_ID)]);

    return {
        queue: {
            waiting: (counts['waiting'] ?? 0) + (counts['prioritized'] ?? 0),
            // The backfill job idles in "delayed" between pages; it is shown as `backfill`, not as queue depth.
            active: counts['active'] ?? 0,
            delayed: Math.max((counts['delayed'] ?? 0) - (backfill ? 1 : 0), 0),
            failed: counts['failed'] ?? 0,
        },
        backfill: backfill ? 'running' : 'idle',
    };
}

export async function loadEmbeddingStatus(db: Kysely<Database>, ml: MlClient | null): Promise<EmbeddingStatusResponse> {
    const mlStatus = await loadMlStatus(ml);
    const model = (info: MlStatus['text']): ModelRef | null => (info ? { model: info.name, version: info.revision } : null);
    const [counts, queue] = await Promise.all([countEmbeddings(db, { text: model(mlStatus.text), image: model(mlStatus.image) }), loadQueueStatus()]);

    return { enabled: ml !== null, ml: mlStatus, ...counts, ...queue };
}
