import { DelayedError, type Job, type Queue } from 'bullmq';

const LIVE_STATES = ['waiting', 'prioritized', 'active'] as const;

/** BullMQ keeps prioritised jobs out of the "waiting" count, so the three live states are added up. */
async function countLiveJobs(queue: Queue): Promise<number> {
    const counts = await queue.getJobCounts(...LIVE_STATES);

    return LIVE_STATES.reduce((sum, state) => sum + (counts[state] ?? 0), 0);
}

/** True while the queue has a job waiting or running. */
export async function hasLiveJobs(queue: Queue): Promise<boolean> {
    return (await countLiveJobs(queue)) > 0;
}

/**
 * True while any of the queues has work in a live state. `self` is the queue the backfill job itself runs in: that job
 * is active there, so one live job is not work.
 */
export async function isQueuesBusy(others: Queue[], self: Queue): Promise<boolean> {
    const [selfLive, otherLive] = await Promise.all([countLiveJobs(self), Promise.all(others.map(hasLiveJobs))]);

    return otherLive.some(Boolean) || selfLive > 1;
}

/**
 * Moves a backfill job to delayed with its next data (or none), then throws `DelayedError`: that tells the worker the
 * job was moved on purpose, so it is neither completed nor failed.
 */
export async function delayBackfillJob(
    job: Pick<Job<object>, 'updateData' | 'moveToDelayed'>,
    nextData: object | null,
    delayMs: number,
    token: string | undefined,
): Promise<never> {
    if (nextData !== null) await job.updateData(nextData);

    await job.moveToDelayed(Date.now() + delayMs, token);

    throw new DelayedError();
}
