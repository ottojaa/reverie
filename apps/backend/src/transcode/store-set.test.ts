import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Rung } from './ladder';
import { storeSet, type SetWriter } from './store-set';

const SEGMENTS = Array.from({ length: 12 }, (_, i) => `v720/seg_${String(i).padStart(3, '0')}.m4s`);
const FILES = ['master.m3u8', 'v720/index.m3u8', ...SEGMENTS];
const RUNGS: Rung[] = [{ name: 720, width: 1280, height: 720, bitrate: 3_000_000, maxrate: 3_200_000, bufsize: 6_000_000 }];

/** Each file is as many bytes as its place in the list, so a total shows whether every file was counted once. */
const BYTES = FILES.reduce((sum, _, i) => sum + i + 1, 0);

describe('storing a rendition set', () => {
    let outDir: string;

    beforeAll(async () => {
        outDir = await mkdtemp(join(tmpdir(), 'reverie-store-set-test-'));

        for (const [i, file] of FILES.entries()) {
            await mkdir(dirname(join(outDir, file)), { recursive: true });
            await writeFile(join(outDir, file), 'x'.repeat(i + 1));
        }
    });
    afterAll(async () => {
        await rm(outDir, { recursive: true, force: true });
    });

    /** A writer whose writes end out of order, recording what it saw. */
    function createWriter(failOn?: string) {
        const seen = { started: [] as string[], done: [] as string[], running: 0, most: 0 };
        const writer: SetWriter = {
            writeFile: async (path) => {
                seen.started.push(path);
                seen.most = Math.max(seen.most, ++seen.running);
                // The first file started is the slowest, so later ones overtake it; a failing one fails at once.
                const delay = failOn && path.endsWith(failOn) ? 0 : Math.max(1, 20 - seen.started.length * 2);
                await sleep(delay);
                seen.running--;

                if (failOn && path.endsWith(failOn)) throw new Error('Disk full: ' + path);

                seen.done.push(path);
            },
        };

        return { writer, seen };
    }

    it('writes several files at once and the master only after every other has been written', async () => {
        const { writer, seen } = createWriter();
        const stored = await storeSet(writer, outDir, 'hash', RUNGS);

        expect(seen.most).toBeGreaterThan(1);
        expect(seen.most).toBeLessThan(FILES.length - 1);
        expect(seen.done).not.toEqual(seen.started);
        expect(seen.started.at(-1)).toBe('transcode/hash/master.m3u8');
        expect(seen.done.at(-1)).toBe('transcode/hash/master.m3u8');
        expect(seen.done).toHaveLength(FILES.length);
        expect(stored.files.at(-1)).toBe('transcode/hash/master.m3u8');
        expect([...stored.files].sort()).toEqual(FILES.map((file) => 'transcode/hash/' + file).sort());
        expect(stored.totalBytes).toBe(BYTES);
        // Everything but the master's one byte is in the rung's folder.
        expect(stored.rungs).toEqual([{ width: 1280, height: 720, bytes: BYTES - 1 }]);
    });

    it('lists the files in the same order however the writes end', async () => {
        const [slow, instant] = await Promise.all([
            storeSet(createWriter().writer, outDir, 'hash', RUNGS),
            storeSet({ writeFile: async () => {} }, outDir, 'hash', RUNGS),
        ]);

        expect(slow.files).toEqual(instant.files);
    });

    it('writes no master and starts nothing more after a failure, and rejects only once the running writes have ended', async () => {
        const { writer, seen } = createWriter('seg_002.m4s');
        const failure = vi.fn();

        await storeSet(writer, outDir, 'hash', RUNGS).catch(failure);

        expect(failure).toHaveBeenCalledWith(new Error('Disk full: transcode/hash/v720/seg_002.m4s'));
        expect(seen.running).toBe(0);
        expect(seen.started).not.toContain('transcode/hash/master.m3u8');
        expect(seen.started.length).toBeLessThan(FILES.length - 1);
    });
});
