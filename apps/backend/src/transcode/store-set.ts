import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { TranscodeRungRecord } from '../db/schema';
import type { Rung } from './ladder';
import { toSetPrefix } from './repository';

export interface SetWriter {
    writeFile: (path: string, buffer: Buffer, contentType?: string) => Promise<void>;
}

export interface StoredSet {
    /** Storage paths, `master.m3u8` included. */
    files: string[];
    rungs: TranscodeRungRecord[];
    totalBytes: number;
}

const MASTER = 'master.m3u8';

/** How many of a set's files are written at once, each held in memory while it is. */
const WRITE_CONCURRENCY = 4;

const CONTENT_TYPES: Record<string, string> = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.mp4': 'video/mp4',
    '.m4s': 'video/iso.segment',
};

function toContentType(name: string): string {
    return CONTENT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream';
}

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)])));

    return nested.flat();
}

/** Runs `task` on every item, `width` at a time. After a failure no further one starts; it throws once those running have ended. */
async function forEachBounded<T>(items: T[], width: number, task: (item: T) => Promise<void>): Promise<void> {
    const remaining = items.values();
    const failures: unknown[] = [];

    async function work(): Promise<void> {
        for (const item of remaining) {
            if (failures.length > 0) return;

            await task(item).catch((error: unknown) => failures.push(error));
        }
    }

    await Promise.all(Array.from({ length: width }, work));

    if (failures.length > 0) throw failures[0];
}

/**
 * Stores everything ffmpeg wrote into `outDir` under the set's prefix, `master.m3u8` last: a player that finds the master
 * finds a complete set. The set is derived data shared by hash, so it is not counted against anyone's storage quota.
 */
export async function storeSet(writer: SetWriter, outDir: string, fileHash: string, rungs: Rung[]): Promise<StoredSet> {
    const prefix = toSetPrefix(fileHash);
    const local = (await listFiles(outDir)).map((path) => path.slice(outDir.length + 1));
    const others = local.filter((path) => path !== MASTER);
    const masters = local.filter((path) => path === MASTER);
    const bytesByDir = new Map<string, number>();
    let totalBytes = 0;

    async function store(relative: string): Promise<void> {
        const content = await readFile(join(outDir, relative));

        await writer.writeFile(`${prefix}/${relative}`, content, toContentType(relative));
        const dir = relative.split('/')[0]!;
        bytesByDir.set(dir, (bytesByDir.get(dir) ?? 0) + content.length);
        totalBytes += content.length;
    }

    await forEachBounded(others, WRITE_CONCURRENCY, store);
    await forEachBounded(masters, 1, store);

    return {
        files: [...others, ...masters].map((relative) => `${prefix}/${relative}`),
        rungs: rungs.map((rung) => ({ width: rung.width, height: rung.height, bytes: bytesByDir.get(`v${rung.name}`) ?? 0 })),
        totalBytes,
    };
}
