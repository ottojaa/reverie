import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { getLlmQueue } from '../queues/llm.queue';
import { getOcrQueue } from '../queues/ocr.queue';
import { getEmbedQueue, type EmbedBackfillCursor } from '../queues/embed.queue';
import { findDocumentsMissingImageEmbeddings, findDocumentsMissingTextEmbeddings } from './embedding.repository';
import { MlUnavailableError, type MlClient } from './ml.client';
import { toModelRef } from './embedding.service';

export type BackfillStep =
    | { kind: 'next'; cursor: EmbedBackfillCursor }
    | { kind: 'wait'; reason: 'ml-not-ready' | 'queues-busy' | 'error' }
    | { kind: 'done' };

export interface BackfillDeps {
    db: Kysely<Database>;
    ml: MlClient;
    /** True while OCR, summaries or the embed queue itself have work, so the backfill does not compete with it. */
    isBusy: () => Promise<boolean>;
    enqueue: (kind: 'embed-text' | 'embed-image', documentId: string) => Promise<void>;
    batchSize: number;
}

/**
 * One page of the backfill: queue the next `batchSize` documents that lack an embedding for the current model.
 * Stateless apart from the cursor: a restart simply asks the database again, and finished documents no longer match.
 * Text first, then images; each stage ends when a page comes back empty.
 */
export async function runBackfillPage(deps: BackfillDeps, cursor: EmbedBackfillCursor): Promise<BackfillStep> {
    let models;

    try {
        models = await deps.ml.readyModels();
    } catch (error) {
        if (error instanceof MlUnavailableError) return { kind: 'wait', reason: 'ml-not-ready' };

        throw error;
    }

    if (await deps.isBusy()) return { kind: 'wait', reason: 'queues-busy' };

    const isText = cursor.stage === 'text';
    const find = isText ? findDocumentsMissingTextEmbeddings : findDocumentsMissingImageEmbeddings;
    const ids = await find(deps.db, toModelRef(isText ? models.text : models.image), cursor.after, deps.batchSize);
    const last = ids.at(-1);

    if (last === undefined) return isText ? { kind: 'next', cursor: { stage: 'image', after: null } } : { kind: 'done' };

    for (const id of ids) await deps.enqueue(isText ? 'embed-text' : 'embed-image', id);

    return { kind: 'next', cursor: { stage: cursor.stage, after: last } };
}

/** Counts waiting, prioritised and active jobs: BullMQ keeps prioritised jobs out of the "waiting" count. */
export async function isPipelineBusy(): Promise<boolean> {
    const [ocr, llm, embed] = await Promise.all(
        [getOcrQueue(), getLlmQueue(), getEmbedQueue()].map((queue) => queue.getJobCounts('waiting', 'prioritized', 'active', 'delayed')),
    );
    const live = (counts: Record<string, number>) => (counts['waiting'] ?? 0) + (counts['prioritized'] ?? 0) + (counts['active'] ?? 0);
    // The backfill job is itself active in the embed queue, so it does not count as work.
    const embedWork = (embed!['waiting'] ?? 0) + (embed!['prioritized'] ?? 0) + Math.max((embed!['active'] ?? 0) - 1, 0);

    return live(ocr!) + live(llm!) + embedWork > 0;
}
