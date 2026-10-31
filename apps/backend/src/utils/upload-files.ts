import { AppError, MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_LABEL } from '@reverie/shared';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { env } from '../config/env';

/**
 * An upload that has been fully received and spooled to a temp file on disk.
 *
 * Uploads are never held in memory: files can be many GB, so they are streamed to disk
 * (hashing on the way) and later moved into storage.
 */
export interface UploadedFile {
    /** Absolute path of the temp file. Moved into storage when the file is stored. */
    tempPath: string;
    size: number;
    /** SHA-256 of the content, hex encoded */
    hash: string;
    filename: string;
    mimetype: string;
}

/**
 * Directory for in-flight uploads. For local storage this lives inside the storage root so the final
 * move into place is a cheap rename on the same filesystem (a multi-GB copy otherwise).
 */
export function getUploadTempDir(): string {
    return env.STORAGE_PROVIDER === 'local' ? join(env.STORAGE_LOCAL_ROOT, '.tmp-uploads') : join(tmpdir(), 'reverie-uploads');
}

export function fileTooLargeError(): AppError {
    return new AppError(413, 'FILE_TOO_LARGE', `File is too large. The maximum upload size is ${MAX_UPLOAD_FILE_SIZE_LABEL} per file.`);
}

/** Minimal shape of a @fastify/multipart file part that we need. */
interface FilePartLike {
    file: Readable & { truncated?: boolean };
    filename: string;
    mimetype: string;
}

/**
 * Stream a multipart file part to a temp file, computing its SHA-256 and size on the way.
 * Aborts (and removes the temp file) as soon as the part exceeds the maximum upload size.
 */
export async function receiveUploadedFile(part: FilePartLike): Promise<UploadedFile> {
    const dir = getUploadTempDir();
    await mkdir(dir, { recursive: true });

    const tempPath = join(dir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;

    const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            size += chunk.length;
            callback(null, chunk);
        },
    });

    // busboy stops emitting data and ends the stream once the size limit is hit; bail out right then
    // instead of waiting for the (possibly huge) remainder of the request.
    const abort = new AbortController();
    part.file.once('limit', () => abort.abort());

    try {
        await pipeline(part.file, tap, createWriteStream(tempPath), { signal: abort.signal });

        if (part.file.truncated || size > MAX_UPLOAD_FILE_SIZE_BYTES) {
            throw fileTooLargeError();
        }
    } catch (err) {
        await rm(tempPath, { force: true }).catch(() => {});

        if (abort.signal.aborted || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
            throw fileTooLargeError();
        }

        throw err;
    }

    return { tempPath, size, hash: hash.digest('hex'), filename: part.filename, mimetype: part.mimetype };
}

/** SHA-256 of an existing file, streamed. */
export async function hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');

    for await (const chunk of createReadStream(path)) {
        hash.update(chunk);
    }

    return hash.digest('hex');
}

/** Remove the temp files of uploads (no-op for files that were already moved into storage). */
export async function discardUploadedFiles(files: Pick<UploadedFile, 'tempPath'>[]): Promise<void> {
    await Promise.all(files.map((f) => rm(f.tempPath, { force: true }).catch(() => {})));
}
