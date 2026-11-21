import type { MlClient } from '../embeddings/ml.client';
import { MlUnavailableError } from '../embeddings/ml.client';
import { KIND_CLASSIFIER, listPrompts, type KindClassifierConfig } from './classifier-config';
import { IMAGE_KINDS, type ImageKind } from './kinds';
import type { PromptEmbeddings } from './classifier';

export interface ImageModelRef {
    model: string;
    version: string;
}

const memo = new Map<string, Promise<PromptEmbeddings>>();

const memoKey = (config: KindClassifierConfig, { model, version }: ImageModelRef) => [config.version, model, version].join('|');

/** Embeds a config's prompts through the image model's text tower, checking it is the model the images were embedded with. */
export async function embedPrompts(ml: MlClient, image: ImageModelRef, config: Pick<KindClassifierConfig, 'prompts'>): Promise<PromptEmbeddings> {
    const entries = listPrompts(config);
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
export function loadPromptEmbeddings(ml: MlClient, image: ImageModelRef, config: KindClassifierConfig = KIND_CLASSIFIER): Promise<PromptEmbeddings> {
    const key = memoKey(config, image);
    const cached = memo.get(key);

    if (cached) return cached;

    const pending = embedPrompts(ml, image, config);

    memo.set(key, pending);
    pending.catch(() => memo.delete(key));

    return pending;
}

/** For tests: forget the memo. */
export function clearPromptCache(): void {
    memo.clear();
}
