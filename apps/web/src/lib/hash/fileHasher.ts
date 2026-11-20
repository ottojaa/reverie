import { hashBlob } from './sha256';
import type { HashWorkerRequest, HashWorkerResponse } from './sha256.worker';

/** Hashes files one at a time, off the main thread when a worker can start, on it (chunked) when not. */
export interface FileHasher {
    hash(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string>;
    dispose(): void;
}

class WorkerUnavailableError extends Error {}

function startWorker(): Worker {
    // Classic (not module) worker: the packaged Electron app loads the page from file://, where a
    // module worker's script cannot be fetched. The wasm is inlined in the bundle, so nothing else is fetched.
    return new Worker(new URL('./sha256.worker.ts', import.meta.url));
}

/**
 * Runs one file in `worker`. Rejects with WorkerUnavailableError when the worker dies before it
 * produced any message (script failed to load), so the caller can fall back to the main thread.
 */
function hashInWorker(worker: Worker, id: number, file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        let heardFromWorker = false;

        const finish = (settle: () => void) => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            signal.removeEventListener('abort', onAbort);
            settle();
        };

        const onAbort = () => {
            worker.postMessage({ type: 'cancel', id } satisfies HashWorkerRequest);
            finish(() => reject(signal.reason));
        };

        const onError = () => finish(() => reject(heardFromWorker ? new Error('Hashing failed') : new WorkerUnavailableError()));

        const onMessage = (event: MessageEvent<HashWorkerResponse>) => {
            const message = event.data;

            if (message.id !== id) return;

            heardFromWorker = true;

            if (message.type === 'progress') onProgress(message.total === 0 ? 1 : message.done / message.total);
            else if (message.type === 'done') finish(() => resolve(message.sha256));
            else finish(() => reject(new Error(message.message)));
        };

        if (signal.aborted) return reject(signal.reason);

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        signal.addEventListener('abort', onAbort);
        worker.postMessage({ type: 'hash', id, file } satisfies HashWorkerRequest);
    });
}

export function createFileHasher(): FileHasher {
    let worker: Worker | null = null;
    let workerBroken = false;
    let nextId = 0;
    let queue: Promise<unknown> = Promise.resolve();
    let pending = 0;

    const ensureWorker = (): Worker | null => {
        if (workerBroken) return null;

        try {
            worker ??= startWorker();

            return worker;
        } catch {
            workerBroken = true;

            return null;
        }
    };

    const hashOne = async (file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> => {
        signal.throwIfAborted();

        const active = ensureWorker();

        if (active) {
            try {
                return await hashInWorker(active, nextId++, file, onProgress, signal);
            } catch (error) {
                if (!(error instanceof WorkerUnavailableError)) throw error;

                workerBroken = true;
                active.terminate();
                worker = null;
            }
        }

        return hashBlob(file, { signal, onProgress: (done, total) => onProgress(total === 0 ? 1 : done / total) });
    };

    return {
        hash(file, onProgress, signal) {
            pending++;
            const result = queue.then(() => hashOne(file, onProgress, signal));
            // The next file waits for this one, whatever happens to it.
            queue = result
                .catch(() => undefined)
                .finally(() => {
                    if (--pending === 0) {
                        worker?.terminate();
                        worker = null;
                    }
                });

            return result;
        },
        dispose() {
            worker?.terminate();
            worker = null;
        },
    };
}
