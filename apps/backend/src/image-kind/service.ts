import type { Kysely } from 'kysely';
import { env } from '../config/env';
import type { Database } from '../db/schema';
import type { MlClient } from '../embeddings/ml.client';
import { MlUnavailableError } from '../embeddings/ml.client';
import { classifyImageKind, type KindVerdict } from './classifier';
import { KIND_CLASSIFIER, type KindClassifierConfig } from './classifier-config';
import { IMAGE_KIND_DECIDES_CATEGORY, KIND_TO_CATEGORY, REPLACEABLE_CATEGORIES, type ImageKind } from './kinds';
import { loadKindInputs, upsertKind, type KindInputs } from './kind.repository';
import { queueLlmAfterKind, type AddLlmJob, type LlmTriggerOutcome } from './llm-trigger';
import { loadPromptEmbeddings } from './prompt-cache';
import { classifyWithSeedSet } from './seed-set';
import { loadSeedSet } from './seed-set.repository';

export interface KindDeps {
    db: Kysely<Database>;
    ml: MlClient;
    /** True when verdicts decide `document_category` and the embed side queues the LLM job. */
    flip: boolean;
    addLlmJob: AddLlmJob;
    /** The classifier to use. Defaults to the committed one; tests pass their own. */
    config?: KindClassifierConfig;
}

/** `no-seed-set`: the version scores by seeds and none were taken for this image model yet (see scripts/snapshot-image-kind-seeds.ts). */
export type ClassifyOutcome = { outcome: 'classified'; kind: ImageKind } | { outcome: 'no-embedding' } | { outcome: 'no-seed-set' };

/** The flip needs the constant on and a local ML service to classify with; without ML_URL today's heuristics stay. */
export function isKindFlipActive(mlConfigured: boolean = Boolean(env.ML_URL)): boolean {
    return IMAGE_KIND_DECIDES_CATEGORY && mlConfigured;
}

/**
 * Classifies an image from its stored embedding and EXIF facts and stores the verdict, and nothing else: no
 * `document_category`, no queue. The prompt embeddings come from the memo, so after the first call this is dot products,
 * and a config with prototypes also reads its frozen seed set. Throws MlUnavailableError when the memo is cold and
 * reverie-ml is down.
 */
export async function classifyDocumentImage(deps: Pick<KindDeps, 'db' | 'ml' | 'config'>, documentId: string): Promise<ClassifyOutcome> {
    const config = deps.config ?? KIND_CLASSIFIER;
    const inputs = await loadKindInputs(deps.db, documentId);

    if (!inputs) return { outcome: 'no-embedding' };

    const verdict = await decideVerdict(deps, config, documentId, inputs);

    if (!verdict) return { outcome: 'no-seed-set' };

    await upsertKind(deps.db, documentId, verdict, inputs.model, config);

    return { outcome: 'classified', kind: verdict.kind };
}

async function decideVerdict(
    deps: Pick<KindDeps, 'db' | 'ml'>,
    config: KindClassifierConfig,
    documentId: string,
    inputs: KindInputs,
): Promise<KindVerdict | null> {
    const prompts = await loadPromptEmbeddings(deps.ml, inputs.model, config);

    if (!config.prototypes) return classifyImageKind(inputs.embedding, prompts, inputs.facts, config);

    const seedSet = await loadSeedSet(deps.db, config.version, inputs.model);

    if (!seedSet) return null;

    return classifyWithSeedSet(inputs.embedding, documentId, prompts, inputs.facts, seedSet, { ...config, prototypes: config.prototypes });
}

/** Sets the category from the verdict, over a missing or heuristic one only: a category the LLM chose is kept. */
async function applyKindCategory(db: Kysely<Database>, documentId: string, kind: ImageKind): Promise<void> {
    await db
        .updateTable('documents')
        .set({ document_category: KIND_TO_CATEGORY[kind] })
        .where('id', '=', documentId)
        .where((eb) => eb.or([eb('document_category', 'is', null), eb('document_category', 'in', [...REPLACEABLE_CATEGORIES])]))
        .execute();
}

export type SettleOutcome = ClassifyOutcome & { llm?: LlmTriggerOutcome };

/**
 * Called when an image embedding is stored and after OCR has stored its EXIF: classify, and with the flip on also
 * set the category and queue the LLM job. Safe to repeat: a verdict is recomputed, the category is idempotent, and
 * the LLM trigger queues once per OCR run.
 */
export async function settleImageKind(deps: KindDeps, documentId: string): Promise<SettleOutcome> {
    const classified = await classifyDocumentImage(deps, documentId);

    if (classified.outcome !== 'classified' || !deps.flip) return classified;

    await applyKindCategory(deps.db, documentId, classified.kind);

    return { ...classified, llm: await queueLlmAfterKind(deps.db, deps.addLlmJob, documentId, classified.kind) };
}

/** Whether reverie-ml is serving: the flipped code paths fall back to today's heuristics when it is not. */
export async function isMlServing(ml: MlClient): Promise<boolean> {
    try {
        await ml.readyModels();

        return true;
    } catch (error) {
        if (error instanceof MlUnavailableError) return false;

        throw error;
    }
}

export type LlmHandoff = 'ocr' | 'embed';

/**
 * Who queues an image's LLM job after OCR. Normally the OCR worker. With the flip on and reverie-ml serving, the embed
 * side does, once the image has a kind. Without ML the image would wait for a verdict that cannot come, so the OCR
 * worker queues it as it does today.
 */
export async function decideLlmHandoff(flip: boolean, ml: MlClient | null): Promise<LlmHandoff> {
    if (!flip || !ml) return 'ocr';

    return (await isMlServing(ml)) ? 'embed' : 'ocr';
}
