import { DelayedError, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { MlRejectedError, MlUnavailableError } from '../embeddings/ml.client';

vi.mock('../db/kysely', () => ({ db: {} }));
vi.mock('../embeddings/embedding.service', () => ({ embedDocumentText: vi.fn(), embedDocumentImage: vi.fn(), toModelRef: vi.fn() }));
vi.mock('../services/storage.service', () => ({ getStorageService: () => ({}) }));

import { embedDocumentImage, embedDocumentText } from '../embeddings/embedding.service';
import { rescheduleBackfill, runEmbedJob, type EmbedWorkerDeps } from './embed.worker';

const settleKind = vi.fn().mockResolvedValue(undefined);
const deps = { settleKind } as unknown as EmbedWorkerDeps;

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

    it('settles the image kind after an image embed, but not after a text embed', async () => {
        settleKind.mockClear();
        vi.mocked(embedDocumentText).mockResolvedValueOnce('embedded');
        vi.mocked(embedDocumentImage).mockResolvedValueOnce('unchanged');

        await runEmbedJob(deps, 'embed-text', 'a');

        expect(settleKind).not.toHaveBeenCalled();

        await runEmbedJob(deps, 'embed-image', 'b');

        expect(settleKind).toHaveBeenCalledWith('b');
    });

    it('settles a classify-image job without embedding anything', async () => {
        settleKind.mockClear();
        vi.mocked(embedDocumentImage).mockClear();

        await runEmbedJob(deps, 'classify-image', 'c');

        expect(settleKind).toHaveBeenCalledWith('c');
        expect(embedDocumentImage).not.toHaveBeenCalled();
    });

    it('retries the job when the kind cannot be settled because reverie-ml went away', async () => {
        const error = new MlUnavailableError('down');

        vi.mocked(embedDocumentImage).mockResolvedValueOnce('embedded');
        settleKind.mockRejectedValueOnce(error);

        await expect(runEmbedJob(deps, 'embed-image', 'd')).rejects.toBe(error);
    });
});

const DELAYS = { pageMs: 20_000, reconcileMs: 6 * 3_600_000 };

describe('backfill rescheduling', () => {
    const stubJob = () => ({ updateData: vi.fn().mockResolvedValue(undefined), moveToDelayed: vi.fn().mockResolvedValue(undefined) });

    it('stores the cursor, moves the same job to delayed and signals DelayedError instead of completing', async () => {
        const job = stubJob();
        const cursor = { stage: 'text', after: 'doc-9' } as const;

        await expect(rescheduleBackfill(job, { kind: 'next', cursor }, DELAYS, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ cursor });
        expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeGreaterThan(Date.now() + 15_000);
    });

    it('waits without moving the cursor when ML is not ready or the queues are busy', async () => {
        const job = stubJob();

        await expect(rescheduleBackfill(job, { kind: 'wait', reason: 'ml-not-ready' }, DELAYS, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).not.toHaveBeenCalled();
        expect(job.moveToDelayed).toHaveBeenCalledOnce();
    });

    it('starts over after the reconcile interval when the library is done', async () => {
        const job = stubJob();

        await expect(rescheduleBackfill(job, { kind: 'done' }, DELAYS, 'token')).rejects.toBeInstanceOf(DelayedError);

        expect(job.updateData).toHaveBeenCalledWith({ cursor: { stage: 'text', after: null } });
        expect(job.moveToDelayed.mock.calls[0]![0]).toBeGreaterThan(Date.now() + 5 * 3_600_000);
    });
});
