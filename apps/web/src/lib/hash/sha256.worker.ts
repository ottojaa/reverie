import { hashBlob } from './sha256';

/** Messages between the page and the hashing worker. */
export type HashWorkerRequest = { type: 'hash'; id: number; file: Blob } | { type: 'cancel'; id: number };
export type HashWorkerResponse =
    | { type: 'progress'; id: number; done: number; total: number }
    | { type: 'done'; id: number; sha256: string }
    | { type: 'error'; id: number; message: string };

const running = new Map<number, AbortController>();

function post(message: HashWorkerResponse): void {
    self.postMessage(message);
}

async function run(id: number, file: Blob): Promise<void> {
    const controller = new AbortController();
    running.set(id, controller);

    try {
        const sha256 = await hashBlob(file, { signal: controller.signal, onProgress: (done, total) => post({ type: 'progress', id, done, total }) });
        post({ type: 'done', id, sha256 });
    } catch (error) {
        post({ type: 'error', id, message: error instanceof Error ? error.message : 'Hashing failed' });
    } finally {
        running.delete(id);
    }
}

self.onmessage = (event: MessageEvent<HashWorkerRequest>) => {
    const message = event.data;

    if (message.type === 'cancel') {
        running.get(message.id)?.abort();

        return;
    }

    void run(message.id, message.file);
};
