import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import {
    deleteTextEmbeddings,
    hasCurrentImageEmbedding,
    hasCurrentTextEmbeddings,
    loadEmbeddableText,
    loadImageSource,
    replaceTextEmbeddings,
    upsertImageEmbedding,
    type ModelRef,
} from './embedding.repository';
import type { MlClient, MlModelInfo } from './ml.client';
import { chunkText } from './text-chunker';

/** Chunks per request to reverie-ml (its limit is 64 texts). */
const TEXT_BATCH = 16;

export interface EmbedDeps {
    db: Kysely<Database>;
    ml: MlClient;
    readFile: (path: string) => Promise<Buffer>;
}

export type EmbedOutcome = 'embedded' | 'unchanged' | 'no-document' | 'no-text' | 'no-image';

export function toModelRef(info: MlModelInfo): ModelRef {
    return { model: info.name, version: info.revision };
}

function md5(content: string | Buffer): string {
    return createHash('md5').update(content).digest('hex');
}

/**
 * Embeds a document's text (summary + OCR text) as chunks. Does nothing when the stored chunks already match the
 * text and the current model. A document that lost all its text loses its chunks too.
 * Throws MlUnavailableError while reverie-ml is down or still loading: the queue retries.
 */
export async function embedDocumentText(deps: EmbedDeps, documentId: string): Promise<EmbedOutcome> {
    const { db, ml } = deps;
    const { text: textModel } = await ml.readyModels();
    const current = toModelRef(textModel);
    const source = await loadEmbeddableText(db, documentId);

    if (!source.exists) return 'no-document';

    if (!source.text) {
        await deleteTextEmbeddings(db, documentId);

        return 'no-text';
    }

    const hash = md5(source.text);

    if (await hasCurrentTextEmbeddings(db, documentId, hash, current)) return 'unchanged';

    const chunks = chunkText(source.text);
    const embeddings: number[][] = [];

    for (let start = 0; start < chunks.length; start += TEXT_BATCH) {
        const batch = chunks.slice(start, start + TEXT_BATCH);
        const result = await ml.embedTexts(
            batch.map((chunk) => chunk.text),
            'passage',
        );

        embeddings.push(...result.embeddings);
    }

    await replaceTextEmbeddings(
        db,
        documentId,
        hash,
        current,
        chunks.map((chunk, i) => ({ index: chunk.index, start: chunk.start, end: chunk.end, embedding: embeddings[i]! })),
    );

    return 'embedded';
}

/** Embeds an image document from its 384px thumbnail rendition. Private images are embedded too: it all stays local. */
export async function embedDocumentImage(deps: EmbedDeps, documentId: string): Promise<EmbedOutcome> {
    const { db, ml, readFile } = deps;
    const { image: imageModel } = await ml.readyModels();
    const current = toModelRef(imageModel);
    const source = await loadImageSource(db, documentId);

    if (!source.exists) return 'no-document';

    if (!source.isImage || !source.thumbnailPath) return 'no-image';

    // The rendition is hashed so a replaced image (same document, new bytes) is embedded again.
    const rendition = await readFile(source.thumbnailPath);
    const hash = md5(rendition);

    if (await hasCurrentImageEmbedding(db, documentId, hash, current)) return 'unchanged';

    const result = await ml.embedImages([rendition]);

    await upsertImageEmbedding(db, documentId, hash, toModelRef(result.model), result.embeddings[0]!);

    return 'embedded';
}
