import { Worker, type Queue } from 'bullmq';
import { hasLiveJobs } from '../queues/backfill-gate';

/** How long a held background worker waits before it looks at the normal queue again. */
const HOLD_MS = 2000;

/**
 * Call before a background lane's job is started. While the normal lane's queue has work, this throws BullMQ's
 * rate-limit error: the job goes back to its place in the background queue without using an attempt, and the worker
 * pauses. A job that has already started runs to its end.
 */
export async function holdWhileNormalBusy(normal: Queue, background: Queue): Promise<void> {
    if (!(await hasLiveJobs(normal))) return;

    await background.rateLimit(HOLD_MS);

    throw Worker.RateLimitError();
}
