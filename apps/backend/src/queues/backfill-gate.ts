import { DelayedError, type Job, type Queue } from 'bullmq';

/**
 * True while any of the queues has work in a live state. BullMQ keeps prioritised jobs out of the "waiting" count, so
 * the three states are added up. `self` is the queue the backfill job itself runs in: that job is active there, so one
 * active job is not work.
 */
export async function isQueuesBusy(others: Queue[], self: Queue): Promise<boolean> {
    const states = ['waiting', 'prioritized', 'active'] as const;
    const [selfCounts, ...otherCounts] = await Promise.all([self, ...others].map((queue) => queue.getJobCounts(...states)));
    const live = (counts: Record<string, number> | undefined) => states.reduce((sum, state) => sum + (counts?.[state] ?? 0), 0);

    return otherCounts.some((counts) => live(counts) > 0) || live(selfCounts) - 1 > 0;
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
