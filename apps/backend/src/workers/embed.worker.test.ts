import { DelayedError, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { EmbedDeps } from '../embeddings/embedding.service';
import { MlRejectedError, MlUnavailableError } from '../embeddings/ml.client';

vi.mock('../db/kysely', () => ({ db: {} }));
vi.mock('../embeddings/embedding.service', () => ({ embedDocumentText: vi.fn(), embedDocumentImage: vi.fn(), toModelRef: vi.fn() }));
vi.mock('../services/storage.service', () => ({ getStorageService: () => ({}) }));

import { embedDocumentImage, embedDocumentText } from '../embeddings/embedding.service';
import { rescheduleBackfill, runEmbedJob } from './embed.worker';

const deps = {} as EmbedDeps;

describe('embed jobs', () => {
    it('lets BullMQ retry while reverie-ml is down: the error passes through unchanged', async () => {
        const error = new MlUnavailableError('down');

        vi.mocked(embedDocumentText).mockRejectedValueOnce(error);
        vi.mocked(embedDocumentImage).mockRejectedValueOnce(error);

        await expect(runEmbedJob(deps, 'embed-text', 'doc')).rejects.toBe(error);
        await expect(runEmbedJob(deps, 'embed-image', 'doc')).rejects.toBe(error);
    });

    it('stops retrying an image that reverie-ml refuses', async () => {
        vi.mocked(embedDocumentImage).mockRejectedValueOnce(new MlRejectedError('undecodable'));

        await expect(runEmbedJob(deps, 'embed-image', 'doc')).rejects.toBeInstanceOf(UnrecoverableError);
    });

    it('routes each job name to its embedder', async () => {
        vi.mocked(embedDocumentText).mockResolvedValueOnce('embedded');
        vi.mocked(embedDocumentImage).mockResolvedValueOnce('embedded');

        await runEmbedJob(deps, 'embed-text', 'a');
        await runEmbedJob(deps, 'embed-image', 'b');

        expect(embedDocumentText).toHaveBeenCalledWith(deps, 'a');
        expect(embedDocumentImage).toHaveBeenCalledWith(deps, 'b');
    });
});

describe('backfill rescheduling', () => {
    const stubJob = () => ({ updateData: vi.fn().mockResolvedValue(undefined), moveToDelayed: vi.fn().mockResolvedValue(undefined) });

    it('stores the cursor, moves the same job to delayed and signals DelayedError instead of completing', async () => {
        const job = stubJob();
        const cursor = { stage: 'text', after: 'doc-9' } as const;

        await expect(rescheduleBackfill(job, { kind: 'next', cursor }, 20_000, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ cursor });
        expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeGreaterThan(Date.now() + 15_000);
    });

    it('waits without moving the cursor when ML is not ready or the queues are busy', async () => {
        const job = stubJob();

        await expect(rescheduleBackfill(job, { kind: 'wait', reason: 'ml-not-ready' }, 20_000, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).not.toHaveBeenCalled();
        expect(job.moveToDelayed).toHaveBeenCalledOnce();
    });

    it('completes normally when the library is done', async () => {
        const job = stubJob();

        await expect(rescheduleBackfill(job, { kind: 'done' }, 20_000, 'token')).resolves.toBeUndefined();

        expect(job.moveToDelayed).not.toHaveBeenCalled();
    });
});
