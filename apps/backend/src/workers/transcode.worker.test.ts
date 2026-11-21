import { DelayedError, type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const counts = vi.hoisted(
    () => ({ ocr: {}, thumbnail: {}, llm: {}, transcode: {} }) as Record<'ocr' | 'thumbnail' | 'llm' | 'transcode', Record<string, number>>,
);
const setStatus = vi.hoisted(() => vi.fn());

vi.mock('../db/kysely', () => ({ db: {} }));
vi.mock('../services/storage.service', () => ({ getStorageService: () => ({}) }));
vi.mock('../queues/ocr.queue', () => ({ getOcrQueue: () => ({ getJobCounts: async () => counts.ocr }) }));
vi.mock('../queues/thumbnail.queue', () => ({ getThumbnailQueue: () => ({ getJobCounts: async () => counts.thumbnail }) }));
vi.mock('../queues/llm.queue', () => ({ getLlmQueue: () => ({ getJobCounts: async () => counts.llm }) }));
vi.mock('../queues/transcode.queue', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../queues/transcode.queue')>()),
    getTranscodeQueue: () => ({ getJobCounts: async () => counts.transcode }),
}));
vi.mock('../transcode/repository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../transcode/repository')>()),
    setTranscodeStatus: setStatus,
}));

import { isTranscodePipelineBusy } from '../transcode/backfill';
import { markFailedWhenFinal, rescheduleTranscodeBackfill } from './transcode.worker';

describe('isTranscodePipelineBusy', () => {
    beforeEach(() => {
        counts.ocr = { waiting: 0, prioritized: 0, active: 0 };
        counts.thumbnail = { waiting: 0, prioritized: 0, active: 0 };
        counts.llm = { waiting: 0, prioritized: 0, active: 0 };
        // The backfill job is itself the one active job in the transcode queue.
        counts.transcode = { waiting: 0, prioritized: 0, active: 1 };
    });

    it('is quiet when only the backfill job itself is running', async () => {
        expect(await isTranscodePipelineBusy()).toBe(false);
    });

    it.each(['ocr', 'thumbnail', 'llm'] as const)('holds the backfill back for %s work in any live state', async (queue) => {
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

describe('markFailedWhenFinal', () => {
    beforeEach(() => setStatus.mockReset().mockResolvedValue(undefined));

    const transcodeJob = (attemptsMade: number, attempts = 3) =>
        ({ name: 'transcode', attemptsMade, opts: { attempts }, data: { documentId: 'doc-1', userId: 'u' } }) as unknown as Job<{
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
