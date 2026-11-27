import { Worker, type Job, type Queue } from 'bullmq';
import { hasLiveJobs } from '../queues/backfill-gate';

/** How long a held background worker waits before it looks at the normal queue again. */
const HOLD_MS = 2000;

/**
 * A background lane's processor: while the normal lane's queue has work, it throws BullMQ's rate-limit error instead of
 * running the job. The job goes back to its place in the background queue without using an attempt, and the worker
 * pauses. A job that has already started runs to its end.
 */
export function heldWhileNormalBusy<Data, Result>(normal: () => Queue, background: () => Queue, run: (job: Job<Data>) => Promise<Result>) {
    return async (job: Job<Data>): Promise<Result> => {
        if (!(await hasLiveJobs(normal()))) return run(job);

        await background().rateLimit(HOLD_MS);

        throw Worker.RateLimitError();
    };
}
