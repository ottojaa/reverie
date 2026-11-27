import { enqueueImageKind } from '../embeddings/enqueue';
import { settleImageKind, type KindDeps } from './service';

/**
 * Classifies an image again once OCR has stored its camera facts: an earlier verdict may have been made without them.
 * An image that already has its embedding is settled here and now, without waiting its turn on the embed queue, which
 * runs one job at a time. Otherwise (no embedding or seed set yet, or a failure) a classify job on that queue does it.
 * Without reverie-ml (`deps` null) there is nothing to do. Never throws: the OCR run has done its work.
 */
export async function settleKindAfterOcr(documentId: string, deps: KindDeps | null): Promise<void> {
    if (!deps) return;

    try {
        const { outcome } = await settleImageKind(deps, documentId);

        if (outcome === 'classified') return;
    } catch (error) {
        console.warn('[ImageKind] Could not classify after OCR, queuing it:', documentId, error instanceof Error ? error.message : String(error));
    }

    await enqueueImageKind(documentId);
}
