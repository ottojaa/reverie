import { createLaneQueues } from './lane-queues';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.config';

export const TRANSCODE_JOBS = {
    TRANSCODE: 'transcode',
    BACKFILL: 'transcode-backfill',
} as const;

export interface TranscodeJobData {
    documentId: string;
    /** Document owner; used to route job events to the owner's socket room only. */
    userId: string;
}

export interface TranscodeBackfillData {
    /** Last document id handled; null at the start of a pass. */
    after: string | null;
}

/** Live jobs have no priority and run first: BullMQ serves lower priority numbers first, and unprioritised jobs before any. */
export const BACKFILL_PRIORITY = 10;

/** One backfill job exists at a time: a restart while it is waiting or delayed collapses into it. */
export const BACKFILL_JOB_ID = 'transcode-backfill';

const queues = createLaneQueues(QUEUE_NAMES.TRANSCODE, QUEUE_NAMES.TRANSCODE_BACKGROUND, {
    ...DEFAULT_JOB_OPTIONS,
    // An encode that fails (the GPU is busy, a disk is full) tries again after a growing wait, and the original stays playable meanwhile.
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
});

export const getTranscodeQueue = queues.normal;
export const getBackgroundTranscodeQueue = queues.background;
export const closeTranscodeQueue = queues.close;

/** `jobId` is the processing_jobs row's id: the worker's tracking updates that row by the BullMQ job id. */
export async function addTranscodeJob(data: TranscodeJobData, jobId: string, priority?: number): Promise<void> {
    await queues.add(TRANSCODE_JOBS.TRANSCODE, data, { jobId, ...(priority !== undefined && { priority }) });
}

export async function addTranscodeBackfillJob(): Promise<void> {
    await getTranscodeQueue().add(TRANSCODE_JOBS.BACKFILL, { after: null } satisfies TranscodeBackfillData, {
        jobId: BACKFILL_JOB_ID,
        priority: BACKFILL_PRIORITY,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
    });
}
