import { env } from '../config/env';
import { addEmbedJob, EMBED_JOBS, type EmbedJobKind } from '../queues/embed.queue';

type Adder = (kind: EmbedJobKind, documentId: string) => Promise<void>;

async function enqueue(kind: EmbedJobKind, documentId: string, add: Adder, enabled: boolean): Promise<void> {
    if (!enabled) return;

    try {
        await add(kind, documentId);
    } catch (error) {
        // Embeddings are a nice-to-have: a Redis hiccup here must never fail OCR, the summary or the thumbnail.
        // The backfill picks up whatever was missed.
        console.warn('[Embed] Could not queue embedding:', kind, documentId, error instanceof Error ? error.message : String(error));
    }
}

/** Queue a text (re-)embed. Best effort: never throws. Does nothing when ML_URL is unset. */
export function enqueueTextEmbedding(documentId: string, add: Adder = addEmbedJob, enabled = Boolean(env.ML_URL)): Promise<void> {
    return enqueue(EMBED_JOBS.TEXT, documentId, add, enabled);
}

/** Queue an image embed. Best effort: never throws. Does nothing when ML_URL is unset. */
export function enqueueImageEmbedding(documentId: string, add: Adder = addEmbedJob, enabled = Boolean(env.ML_URL)): Promise<void> {
    return enqueue(EMBED_JOBS.IMAGE, documentId, add, enabled);
}

/** Queue a classification of an image's kind from its stored embedding. Best effort: never throws. Does nothing when ML_URL is unset. */
export function enqueueImageKind(documentId: string, add: Adder = addEmbedJob, enabled = Boolean(env.ML_URL)): Promise<void> {
    return enqueue(EMBED_JOBS.CLASSIFY, documentId, add, enabled);
}
