import { readFile, readdir, stat } from 'fs/promises';
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

/**
 * Stores everything ffmpeg wrote into `outDir` under the set's prefix, `master.m3u8` last: a player that finds the master
 * finds a complete set. The set is derived data shared by hash, so it is not counted against anyone's storage quota.
 */
export async function storeSet(writer: SetWriter, outDir: string, fileHash: string, rungs: Rung[]): Promise<StoredSet> {
    const prefix = toSetPrefix(fileHash);
    const local = (await listFiles(outDir)).map((path) => path.slice(outDir.length + 1));
    const ordered = [...local.filter((path) => path !== 'master.m3u8'), ...local.filter((path) => path === 'master.m3u8')];
    const bytesByDir = new Map<string, number>();
    let totalBytes = 0;

    for (const relative of ordered) {
        const { size } = await stat(join(outDir, relative));

        await writer.writeFile(`${prefix}/${relative}`, await readFile(join(outDir, relative)), toContentType(relative));
        bytesByDir.set(relative.split('/')[0]!, (bytesByDir.get(relative.split('/')[0]!) ?? 0) + size);
        totalBytes += size;
    }

    return {
        files: ordered.map((relative) => `${prefix}/${relative}`),
        rungs: rungs.map((rung) => ({ width: rung.width, height: rung.height, bytes: bytesByDir.get(`v${rung.name}`) ?? 0 })),
        totalBytes,
    };
}
