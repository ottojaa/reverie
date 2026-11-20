import { createSHA256 } from 'hash-wasm';

/** How much of a file is read into memory at once. Uploads go up to 20 GB, so a file is never read whole. */
export const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

export interface HashOptions {
    chunkSize?: number;
    /** Called after each chunk with the bytes hashed so far. */
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
}

/**
 * SHA-256 of a file as lower-case hex: the value the server stores as `documents.file_hash`.
 *
 * WebCrypto's `digest` takes the whole input at once, so this feeds hash-wasm's incremental hasher
 * one slice at a time. Each slice is read, hashed and dropped before the next one is read, and the
 * awaited read yields to the event loop between chunks, so it is also safe to run on the main thread.
 */
export async function hashBlob(blob: Blob, { chunkSize = HASH_CHUNK_BYTES, onProgress, signal }: HashOptions = {}): Promise<string> {
    const hasher = await createSHA256();
    hasher.init();

    for (let offset = 0; offset < blob.size; offset += chunkSize) {
        signal?.throwIfAborted();

        const end = Math.min(offset + chunkSize, blob.size);
        hasher.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
        onProgress?.(end, blob.size);
    }

    signal?.throwIfAborted();

    return hasher.digest('hex');
}
