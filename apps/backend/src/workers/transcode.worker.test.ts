import { DelayedError, type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CountedQueue = 'ocr' | 'backgroundOcr' | 'thumbnail' | 'backgroundThumbnail' | 'llm' | 'transcode' | 'backgroundTranscode';

const counts = vi.hoisted(() => ({}) as Record<CountedQueue, Record<string, number>>);
const setStatus = vi.hoisted(() => vi.fn());
const markJobFailed = vi.hoisted(() => vi.fn());

vi.mock('../db/kysely', () => ({ db: {} }));
vi.mock('../jobs/job.service', () => ({ getJobService: () => ({ markJobFailed }) }));
vi.mock('../services/storage.service', () => ({ getStorageService: () => ({}) }));
vi.mock('../queues/ocr.queue', () => ({
    getOcrQueue: () => ({ getJobCounts: async () => counts.ocr }),
    getBackgroundOcrQueue: () => ({ getJobCounts: async () => counts.backgroundOcr }),
}));
vi.mock('../queues/thumbnail.queue', () => ({
    getThumbnailQueue: () => ({ getJobCounts: async () => counts.thumbnail }),
    getBackgroundThumbnailQueue: () => ({ getJobCounts: async () => counts.backgroundThumbnail }),
}));
vi.mock('../queues/llm.queue', () => ({ getLlmQueue: () => ({ getJobCounts: async () => counts.llm }) }));
vi.mock('../queues/transcode.queue', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../queues/transcode.queue')>()),
    getTranscodeQueue: () => ({ getJobCounts: async () => counts.transcode }),
    getBackgroundTranscodeQueue: () => ({ getJobCounts: async () => counts.backgroundTranscode }),
}));
vi.mock('../transcode/repository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../transcode/repository')>()),
    setTranscodeStatus: setStatus,
}));

import { isTranscodePipelineBusy } from '../transcode/backfill';
import { isLastAttempt, markFailedWhenFinal, rescheduleTranscodeBackfill } from './transcode.worker';

describe('isTranscodePipelineBusy', () => {
    beforeEach(() => {
        counts.ocr = { waiting: 0, prioritized: 0, active: 0 };
        counts.backgroundOcr = { waiting: 0, prioritized: 0, active: 0 };
        counts.thumbnail = { waiting: 0, prioritized: 0, active: 0 };
        counts.backgroundThumbnail = { waiting: 0, prioritized: 0, active: 0 };
        counts.llm = { waiting: 0, prioritized: 0, active: 0 };
        counts.backgroundTranscode = { waiting: 0, prioritized: 0, active: 0 };
        // The backfill job is itself the one active job in the transcode queue.
        counts.transcode = { waiting: 0, prioritized: 0, active: 1 };
    });

    it('is quiet when only the backfill job itself is running', async () => {
        expect(await isTranscodePipelineBusy()).toBe(false);
    });

    const AHEAD = ['ocr', 'backgroundOcr', 'thumbnail', 'backgroundThumbnail', 'llm', 'backgroundTranscode'] as const;

    it.each(AHEAD)('holds the backfill back for %s work in any live state', async (queue) => {
        for (const state of ['waiting', 'prioritized', 'active']) {
            counts[queue] = { waiting: 0, prioritized: 0, active: 0, [state]: 1 };

            expect(await isTranscodePipelineBusy()).toBe(true);
        }
    });
});

describe('backfill rescheduling', () => {
    const DELAYS = { pageMs: 30_000, reconcileMs: 3_600_000 };
    const stubJob = () => ({ updateData: vi.fn().mockResolvedValue(undefined), moveToDelayed: vi.fn().mockResolvedValue(undefined) });

    it('stores the cursor and moves the same job to delayed instead of completing it', async () => {
        const job = stubJob();

        await expect(rescheduleTranscodeBackfill(job, { kind: 'next', after: 'doc-9' }, DELAYS, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ after: 'doc-9' });
        expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeLessThan(Date.now() + 31_000);
    });

    it('starts over after the reconcile interval when the library is done', async () => {
        const job = stubJob();

        await expect(rescheduleTranscodeBackfill(job, { kind: 'done' }, DELAYS, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ after: null });
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeGreaterThan(Date.now() + 3_500_000);
    });
});

describe('isLastAttempt', () => {
    const jobOn = (attemptsMade: number, attempts?: number) => ({ attemptsMade, opts: { attempts } });

    it('is true only on the last try, which is the one before markFailedWhenFinal gives up', () => {
        expect([0, 1, 2].map((made) => isLastAttempt(jobOn(made, 3)))).toEqual([false, false, true]);
    });

    it('is never true for a job with a single try', () => {
        expect(isLastAttempt(jobOn(0, 1))).toBe(false);
        expect(isLastAttempt(jobOn(0))).toBe(false);
    });
});

describe('markFailedWhenFinal', () => {
    beforeEach(() => {
        setStatus.mockReset().mockResolvedValue(undefined);
        markJobFailed.mockReset().mockResolvedValue(undefined);
    });

    const transcodeJob = (attemptsMade: number, attempts = 3, finishedOn?: number) =>
        ({ id: 'job-1', name: 'transcode', attemptsMade, finishedOn, opts: { attempts }, data: { documentId: 'doc-1', userId: 'u' } }) as unknown as Job<{
            documentId: string;
            userId: string;
        }>;

    it('leaves the video as it is while retries remain', async () => {
        await markFailedWhenFinal(transcodeJob(1), new Error('ffmpeg failed: boom'));

        expect(setStatus).not.toHaveBeenCalled();
    });

    it('marks the video failed when the last attempt is used up', async () => {
        await markFailedWhenFinal(transcodeJob(3), new Error('ffmpeg failed: boom'));

        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'doc-1', 'failed');
    });

    it('marks the video failed when BullMQ gives up on a stalled job with attempts to spare', async () => {
        // A job stalled more than once is failed by BullMQ with only 1 of 3 attempts counted, and `finishedOn` set.
        await markFailedWhenFinal(transcodeJob(1, 3, Date.now()), new Error('job stalled more than allowable limit'));

        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'doc-1', 'failed');
        // Its tracking row never saw the failure, so it would otherwise stay live and block a re-queue.
        expect(markJobFailed).toHaveBeenCalledWith('job-1', 'job stalled more than allowable limit', 1);
    });

    it('still marks the video failed when its tracking row cannot be written', async () => {
        markJobFailed.mockRejectedValue(new Error('db down'));

        await markFailedWhenFinal(transcodeJob(1, 3, Date.now()), new Error('job stalled more than allowable limit'));

        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'doc-1', 'failed');
    });

    it('leaves the tracking row alone when the last attempt was used up: the tracking wrapper already failed it', async () => {
        await markFailedWhenFinal(transcodeJob(3, 3, Date.now()), new Error('ffmpeg failed: boom'));

        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'doc-1', 'failed');
        expect(markJobFailed).not.toHaveBeenCalled();
    });

    it('marks it failed at once for an error that can never succeed', async () => {
        const error = new Error('Source has no picture size: doc-1');

        error.name = 'NonRetryableJobError';
        await markFailedWhenFinal(transcodeJob(1), error);

        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'doc-1', 'failed');
    });

    it('ignores the backfill job and a missing job', async () => {
        await markFailedWhenFinal({ ...transcodeJob(3), name: 'transcode-backfill' } as never, new Error('x'));
        await markFailedWhenFinal(undefined, new Error('x'));

        expect(setStatus).not.toHaveBeenCalled();
    });

    it('does not throw when the status cannot be written', async () => {
        setStatus.mockRejectedValueOnce(new Error('db down'));

        await expect(markFailedWhenFinal(transcodeJob(3), new Error('x'))).resolves.toBeUndefined();
    });
});
