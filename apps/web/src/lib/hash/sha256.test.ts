import { createHash, randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { hashBlob } from './sha256';

/** What the server stores as `documents.file_hash` for these bytes. */
const serverHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('hashBlob', () => {
    it('matches the known SHA-256 test vector for "abc"', async () => {
        expect(await hashBlob(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('hashes an empty file', async () => {
        expect(await hashBlob(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it.each([
        ['one byte under a chunk', 1023],
        ['exactly one chunk', 1024],
        ['one byte over a chunk', 1025],
        ['an exact multiple of the chunk size', 4096],
        ['many chunks', 100_003],
    ])('equals the server file_hash for %s', async (_label, size) => {
        const bytes = randomBytes(size);

        expect(await hashBlob(new Blob([bytes]), { chunkSize: 1024 })).toBe(serverHash(bytes));
    });

    it('gives the same hash whatever the chunk size', async () => {
        const blob = new Blob([randomBytes(50_000)]);

        expect(await hashBlob(blob, { chunkSize: 7 * 1024 })).toBe(await hashBlob(blob, { chunkSize: 50_000 }));
    });

    it('reads a large file in chunks, never all at once', async () => {
        const size = 10 * 1024 * 1024 + 123;
        const blob = new Blob([randomBytes(size)]);
        const readSizes: number[] = [];
        const spied = new Proxy(blob, {
            get(target, prop) {
                if (prop !== 'slice') return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);

                return (start: number, end: number) => {
                    readSizes.push(end - start);

                    return target.slice(start, end);
                };
            },
        });
        const chunk = 1024 * 1024;

        const hash = await hashBlob(spied, { chunkSize: chunk });

        expect(readSizes.length).toBe(Math.ceil(size / chunk));
        expect(Math.max(...readSizes)).toBeLessThanOrEqual(chunk);
        expect(readSizes.reduce((a, b) => a + b, 0)).toBe(size);
        expect(hash).toBe(serverHash(new Uint8Array(await blob.arrayBuffer())));
    });

    it('reports progress up to the full size', async () => {
        const calls: Array<[number, number]> = [];

        await hashBlob(new Blob([randomBytes(2500)]), { chunkSize: 1000, onProgress: (done, total) => calls.push([done, total]) });

        expect(calls).toEqual([
            [1000, 2500],
            [2000, 2500],
            [2500, 2500],
        ]);
    });

    it('stops when aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(hashBlob(new Blob([randomBytes(10)]), { signal: controller.signal })).rejects.toThrow();
    });
});
