import { isFileTooLarge, type UploadFile } from '@/lib/upload';
import { useEffect, useRef, useState } from 'react';
import { createFileHasher, type FileHasher } from './fileHasher';

export type FileHashState =
    | { status: 'hashing'; progress: number }
    | { status: 'done'; sha256: string }
    /** Could not be read or hashed: the file is checked by name only. */
    | { status: 'error' }
    /** Not hashed on purpose (it can't be uploaded anyway). */
    | { status: 'skipped' };

/** How often a file's progress is pushed into React state: a 20 GB file reports every 8 MiB. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * SHA-256 of every queued file, computed as soon as it is added, one file at a time and off the main
 * thread. Entries for files that leave the queue are dropped and their hashing is cancelled.
 */
export function useFileHashes(files: UploadFile[]): Record<string, FileHashState> {
    const [hashes, setHashes] = useState<Record<string, FileHashState>>({});
    const hasherRef = useRef<FileHasher | null>(null);
    const controllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        const running = controllers.current;

        return () => {
            for (const controller of running.values()) controller.abort();
            running.clear();
            hasherRef.current?.dispose();
            hasherRef.current = null;
        };
    }, []);

    useEffect(() => {
        const running = controllers.current;
        const present = new Set(files.map((f) => f.id));

        for (const [id, controller] of running) {
            if (present.has(id)) continue;

            controller.abort();
            running.delete(id);
        }

        setHashes((current) => {
            const stale = Object.keys(current).filter((id) => !present.has(id));

            if (stale.length === 0) return current;

            return Object.fromEntries(Object.entries(current).filter(([id]) => present.has(id)));
        });

        for (const upload of files) {
            if (upload.status !== 'queued' || running.has(upload.id)) continue;

            const controller = new AbortController();
            running.set(upload.id, controller);
            hasherRef.current ??= createFileHasher();
            void hashFile(hasherRef.current, upload, controller.signal, (state) => setHashes((current) => ({ ...current, [upload.id]: state })));
        }
    }, [files]);

    return hashes;
}

async function hashFile(hasher: FileHasher, upload: UploadFile, signal: AbortSignal, publish: (state: FileHashState) => void): Promise<void> {
    if (isFileTooLarge(upload.file)) return publish({ status: 'skipped' });

    let lastPublished = 0;
    publish({ status: 'hashing', progress: 0 });

    try {
        const sha256 = await hasher.hash(
            upload.file,
            (progress) => {
                const now = Date.now();

                if (now - lastPublished < PROGRESS_INTERVAL_MS) return;

                lastPublished = now;
                publish({ status: 'hashing', progress });
            },
            signal,
        );

        if (!signal.aborted) publish({ status: 'done', sha256 });
    } catch {
        // Aborted: the file left the queue, so there is nothing to report. Anything else: name-only check.
        if (!signal.aborted) publish({ status: 'error' });
    }
}
