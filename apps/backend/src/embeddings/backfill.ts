import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { getLlmQueue } from '../queues/llm.queue';
import { getOcrQueue } from '../queues/ocr.queue';
import { findDocumentsMissingMediaRead } from '../media/media-read';
import type { KindClassifierConfig } from '../image-kind/classifier-config';
import { findDocumentsMissingKind } from '../image-kind/kind.repository';
import { getEmbedQueue, type EmbedBackfillCursor, type EmbedJobKind } from '../queues/embed.queue';
import { findDocumentsMissingImageEmbeddings, findDocumentsMissingTextEmbeddings } from './embedding.repository';
import { MlUnavailableError, type MlClient } from './ml.client';
import { toModelRef } from './embedding.service';
import { UNDERSTAND_PAGE_SIZE, findImagesToUnderstand } from '../llm/understand-backfill';

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
    /** Queues the image call for one image; absent when the call is off (no API key or vision disabled), which skips that stage. */
    queueUnderstanding?: (documentId: string) => Promise<unknown>;
    batchSize: number;
    /** The classifier whose verdicts the kind stage fills in. Defaults to the committed one. */
    classifier?: KindClassifierConfig;
}

const STAGES = {
    text: { next: 'image', job: 'embed-text' },
    image: { next: 'camera', job: 'embed-image' },
    // Reads each image's EXIF and each video's ffprobe facts from the stored file. The names stay from when it only read the camera: jobs already in Redis carry them.
    camera: { next: 'kind', job: 'read-camera' },
    kind: { next: 'understand', job: 'classify-image' },
    // Not an embed job: it queues the image call (see queueUnderstanding).
    understand: { next: null, job: null },
} as const;

type ReadyModels = Awaited<ReturnType<MlClient['readyModels']>>;

function findMissing(deps: BackfillDeps, stage: EmbedBackfillCursor['stage'], models: ReadyModels, after: string | null): Promise<string[]> {
    if (stage === 'text') return findDocumentsMissingTextEmbeddings(deps.db, toModelRef(models.text), after, deps.batchSize);

    if (stage === 'image') return findDocumentsMissingImageEmbeddings(deps.db, toModelRef(models.image), after, deps.batchSize);

    if (stage === 'camera') return findDocumentsMissingMediaRead(deps.db, after, deps.batchSize);

    if (stage === 'understand') return findImagesToUnderstand(deps.db, after, Math.min(deps.batchSize, UNDERSTAND_PAGE_SIZE));

    return findDocumentsMissingKind(deps.db, toModelRef(models.image), after, deps.batchSize, deps.classifier);
}

function enqueueOne(deps: BackfillDeps, job: EmbedJobKind | null, id: string): Promise<unknown> {
    return job === null ? deps.queueUnderstanding!(id) : deps.enqueue(job, id);
}

/**
 * One page of the backfill: queue the next `batchSize` documents that lack an embedding for the current model, a read of the stored file's EXIF or video facts, or an image kind verdict from the current classifier, then queue the image call for screenshots and document images that lack it. Stateless apart from the cursor: a restart simply asks the database
 * again, and finished documents no longer match. Text, then images, then media reads (EXIF of images, ffprobe of videos; an image's ends with a new verdict), then kinds, then image summaries; each stage ends when a page comes back empty.
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

    // Without the image call the last stage has nothing to do.
    if (cursor.stage === 'understand' && !deps.queueUnderstanding) return { kind: 'done' };

    const ids = await findMissing(deps, cursor.stage, models, cursor.after);
    const last = ids.at(-1);

    if (last === undefined) return stage.next === null ? { kind: 'done' } : { kind: 'next', cursor: { stage: stage.next, after: null } };

    for (const id of ids) await enqueueOne(deps, stage.job, id);

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
