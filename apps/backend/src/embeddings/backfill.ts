import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { getLlmQueue } from '../queues/llm.queue';
import { getOcrQueue } from '../queues/ocr.queue';
import { findDocumentsMissingCameraRead } from '../image-kind/camera-read';
import type { KindClassifierConfig } from '../image-kind/classifier-config';
import { findDocumentsMissingKind } from '../image-kind/kind.repository';
import { getEmbedQueue, type EmbedBackfillCursor, type EmbedJobKind } from '../queues/embed.queue';
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
    enqueue: (kind: EmbedJobKind, documentId: string) => Promise<void>;
    batchSize: number;
    /** The classifier whose verdicts the kind stage fills in. Defaults to the committed one. */
    classifier?: KindClassifierConfig;
}

const STAGES = {
    text: { next: 'image', job: 'embed-text' },
    image: { next: 'camera', job: 'embed-image' },
    camera: { next: 'kind', job: 'read-camera' },
    kind: { next: null, job: 'classify-image' },
} as const;

type ReadyModels = Awaited<ReturnType<MlClient['readyModels']>>;

function findMissing(deps: BackfillDeps, stage: EmbedBackfillCursor['stage'], models: ReadyModels, after: string | null): Promise<string[]> {
    if (stage === 'text') return findDocumentsMissingTextEmbeddings(deps.db, toModelRef(models.text), after, deps.batchSize);

    if (stage === 'image') return findDocumentsMissingImageEmbeddings(deps.db, toModelRef(models.image), after, deps.batchSize);

    if (stage === 'camera') return findDocumentsMissingCameraRead(deps.db, after, deps.batchSize);

    return findDocumentsMissingKind(deps.db, toModelRef(models.image), after, deps.batchSize, deps.classifier);
}

/**
 * One page of the backfill: queue the next `batchSize` documents that lack an embedding for the current model, a camera
 * read of the stored file, or an image kind verdict from the current classifier. Stateless apart from the cursor: a restart simply asks the database
 * again, and finished documents no longer match. Text, then images, then camera reads (each ends with a new verdict), then kinds; each stage ends when a page comes back empty.
 */
export async function runBackfillPage(deps: BackfillDeps, cursor: EmbedBackfillCursor): Promise<BackfillStep> {
    let models: ReadyModels;

    try {
        models = await deps.ml.readyModels();
    } catch (error) {
        if (error instanceof MlUnavailableError) return { kind: 'wait', reason: 'ml-not-ready' };

        throw error;
    }

    if (await deps.isBusy()) return { kind: 'wait', reason: 'queues-busy' };

    const stage = STAGES[cursor.stage];
    const ids = await findMissing(deps, cursor.stage, models, cursor.after);
    const last = ids.at(-1);

    if (last === undefined) return stage.next === null ? { kind: 'done' } : { kind: 'next', cursor: { stage: stage.next, after: null } };

    for (const id of ids) await deps.enqueue(stage.job, id);

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
