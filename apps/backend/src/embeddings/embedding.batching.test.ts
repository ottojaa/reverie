import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/schema';
import { createFakeMl } from '../testing/fake-ml';
import { embedDocumentText } from './embedding.service';
import { MAX_CHUNKS } from './text-chunker';

const repository = vi.hoisted(() => ({
    loadEmbeddableText: vi.fn(),
    hasCurrentTextEmbeddings: vi.fn(),
    replaceTextEmbeddings: vi.fn(),
    deleteTextEmbeddings: vi.fn(),
}));

vi.mock('./embedding.repository', () => repository);

/** reverie-ml answers 422 for more than this many texts in one request, and 422 is a non-retryable failure. */
const ML_MAX_TEXTS = 64;

describe('text embedding requests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repository.hasCurrentTextEmbeddings.mockResolvedValue(false);
    });

    it('splits a very long document into requests reverie-ml accepts and keeps every chunk', async () => {
        const ml = createFakeMl();

        repository.loadEmbeddableText.mockResolvedValue({ exists: true, text: 'Lorem ipsum dolor sit amet. '.repeat(20_000) });

        await expect(embedDocumentText({ db: {} as Kysely<Database>, ml, readFile: vi.fn() }, 'doc')).resolves.toBe('embedded');

        const sizes = ml.textCalls.map((texts) => texts.length);

        expect(sizes.length).toBeGreaterThan(1);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(ML_MAX_TEXTS);

        const stored = repository.replaceTextEmbeddings.mock.calls[0]![4] as { index: number }[];

        expect(stored).toHaveLength(MAX_CHUNKS);
        expect(stored.map((chunk) => chunk.index)).toEqual(Array.from({ length: MAX_CHUNKS }, (_, i) => i));
    });
});
