import { describe, expect, it, vi } from 'vitest';
import { enqueueImageEmbedding, enqueueTextEmbedding } from './enqueue';

describe('best-effort embedding enqueue', () => {
    it('queues the right kind of job when embeddings are on', async () => {
        const add = vi.fn().mockResolvedValue(undefined);

        await enqueueTextEmbedding('doc-1', add, true);
        await enqueueImageEmbedding('doc-2', add, true);

        expect(add).toHaveBeenNthCalledWith(1, 'embed-text', 'doc-1');
        expect(add).toHaveBeenNthCalledWith(2, 'embed-image', 'doc-2');
    });

    it('queues nothing when ML_URL is unset', async () => {
        const add = vi.fn();

        await enqueueTextEmbedding('doc-1', add, false);
        await enqueueImageEmbedding('doc-1', add, false);

        expect(add).not.toHaveBeenCalled();
    });

    it('never throws into the OCR, summary or thumbnail worker when Redis fails', async () => {
        const add = vi.fn().mockRejectedValue(new Error('Redis is down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(enqueueTextEmbedding('doc-1', add, true)).resolves.toBeUndefined();
        await expect(enqueueImageEmbedding('doc-1', add, true)).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});
