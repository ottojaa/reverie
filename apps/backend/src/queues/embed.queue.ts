import { Queue } from 'bullmq';
import { toLaneJob } from './lane';
import { QUEUE_NAMES } from './queue.config';
import { getRedisConnectionOptions } from './redis';

export const EMBED_JOBS = {
    TEXT: 'embed-text',
    IMAGE: 'embed-image',
    CLASSIFY: 'classify-image',
    READ_CAMERA: 'read-camera',
    SCAN_DUPLICATES: 'scan-duplicates',
    BACKFILL: 'embed-backfill',
} as const;

export type EmbedJobKind =
    | typeof EMBED_JOBS.TEXT
    | typeof EMBED_JOBS.IMAGE
    | typeof EMBED_JOBS.CLASSIFY
    | typeof EMBED_JOBS.READ_CAMERA
    | typeof EMBED_JOBS.SCAN_DUPLICATES;

export interface EmbedJobData {
    documentId: string;
}

export interface EmbedBackfillCursor {
    stage: 'text' | 'image' | 'camera' | 'kind' | 'duplicates' | 'understand';
    /** Last document id handled in this stage; null at the start of a stage. */
    after: string | null;
}

export interface EmbedBackfillData {
    cursor: EmbedBackfillCursor;
}

/** Live work runs ahead of the backfill: BullMQ serves lower priority numbers first, and unprioritised jobs before any. */
export const BACKFILL_PRIORITY = 10;

/** One backfill job exists at a time: a restart while it is waiting or delayed collapses into it. */
export const BACKFILL_JOB_ID = 'embed-backfill';

let embedQueueInstance: Queue | null = null;

export function getEmbedQueue(): Queue {
    if (!embedQueueInstance) {
        embedQueueInstance = new Queue(QUEUE_NAMES.EMBED, {
            connection: getRedisConnectionOptions(),
            defaultJobOptions: {
                // reverie-ml can be down for a while (first start downloads several GB): back off from 30 s, about an hour in all (seven retries: 30 s doubling, ~63 min).
                attempts: 8,
                backoff: { type: 'exponential', delay: 30_000 },
                removeOnComplete: true,
                removeOnFail: { count: 200 },
            },
        });
    }

    return embedQueueInstance;
}

export async function addEmbedJob(kind: EmbedJobKind, documentId: string, priority?: number): Promise<void> {
    const { options } = await toLaneJob(documentId, priority === undefined ? {} : { priority });
    await getEmbedQueue().add(kind, { documentId } satisfies EmbedJobData, options);
}

export async function addEmbedBackfillJob(): Promise<void> {
    const cursor: EmbedBackfillCursor = { stage: 'text', after: null };

    await getEmbedQueue().add(EMBED_JOBS.BACKFILL, { cursor } satisfies EmbedBackfillData, {
        jobId: BACKFILL_JOB_ID,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
    });
}

export async function closeEmbedQueue(): Promise<void> {
    if (embedQueueInstance) {
        await embedQueueInstance.close();
        embedQueueInstance = null;
    }
}
