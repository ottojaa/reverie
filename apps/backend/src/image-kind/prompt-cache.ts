import type { MlClient } from '../embeddings/ml.client';
import { MlUnavailableError } from '../embeddings/ml.client';
import { IMAGE_KINDS, KIND_CLASSIFIER_VERSION, KIND_PROMPTS, type ImageKind } from './kinds';
import type { PromptEmbeddings } from './classifier';

export interface ImageModelRef {
    model: string;
    version: string;
}

const memo = new Map<string, Promise<PromptEmbeddings>>();

const memoKey = ({ model, version }: ImageModelRef) => [KIND_CLASSIFIER_VERSION, model, version].join('|');

async function embedPrompts(ml: MlClient, image: ImageModelRef): Promise<PromptEmbeddings> {
    const entries = IMAGE_KINDS.flatMap((kind) => KIND_PROMPTS[kind].map((text) => ({ kind, text })));
    const result = await ml.embedImageTexts(entries.map((entry) => entry.text));

    // The service may have moved to another model since the image was embedded: those prompts would not compare.
    if (result.model.name !== image.model || result.model.revision !== image.version) {
        throw new MlUnavailableError('reverie-ml serves another image model than the stored embedding: ' + result.model.name);
    }

    const prompts = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, [] as number[][]])) as Record<ImageKind, number[][]>;

    entries.forEach((entry, i) => prompts[entry.kind].push(result.embeddings[i]!));

    return prompts;
}

/**
 * The prompt embeddings for an image model, computed once per classifier version and model (the first call asks
 * reverie-ml, a failure is not remembered). After that a classification is dot products with no call at all.
 * `image` is the model recorded on the image embedding being classified.
 */
export function loadPromptEmbeddings(ml: MlClient, image: ImageModelRef): Promise<PromptEmbeddings> {
    const key = memoKey(image);
    const cached = memo.get(key);

    if (cached) return cached;

    const pending = embedPrompts(ml, image);

    memo.set(key, pending);
    pending.catch(() => memo.delete(key));

    return pending;
}

/** For tests: forget the memo. */
export function clearPromptCache(): void {
    memo.clear();
}
