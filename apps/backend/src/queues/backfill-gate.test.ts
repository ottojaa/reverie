import { DelayedError, type Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { delayBackfillJob, isQueuesBusy } from './backfill-gate';

const toQueue = (counts: Record<string, number>) => ({ getJobCounts: async () => counts }) as unknown as Queue;
const idle = { waiting: 0, prioritized: 0, active: 0 };

describe('isQueuesBusy', () => {
    it('is quiet when only the backfill job itself is active', async () => {
        expect(await isQueuesBusy([toQueue(idle)], toQueue({ ...idle, active: 1 }))).toBe(false);
    });

    it.each(['waiting', 'prioritized', 'active'])('is busy for another queue with a %s job', async (state) => {
        expect(await isQueuesBusy([toQueue({ ...idle, [state]: 1 })], toQueue({ ...idle, active: 1 }))).toBe(true);
    });

    it('is busy for more work in its own queue, queued (prioritised too) or running', async () => {
        expect(await isQueuesBusy([], toQueue({ ...idle, waiting: 1, active: 1 }))).toBe(true);
        expect(await isQueuesBusy([], toQueue({ ...idle, prioritized: 2, active: 1 }))).toBe(true);
        expect(await isQueuesBusy([], toQueue({ ...idle, active: 2 }))).toBe(true);
    });
});

describe('delayBackfillJob', () => {
    const stubJob = () => ({ updateData: vi.fn().mockResolvedValue(undefined), moveToDelayed: vi.fn().mockResolvedValue(undefined) });

    it('stores the next data and moves the job to delayed, throwing DelayedError', async () => {
        const job = stubJob();

        await expect(delayBackfillJob(job, { after: 'doc-9' }, 30_000, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ after: 'doc-9' });
        expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeLessThan(Date.now() + 31_000);
    });

    it('leaves the data alone when there is no next data', async () => {
        const job = stubJob();

        await expect(delayBackfillJob(job, null, 30_000, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).not.toHaveBeenCalled();
        expect(job.moveToDelayed).toHaveBeenCalledOnce();
    });
});
