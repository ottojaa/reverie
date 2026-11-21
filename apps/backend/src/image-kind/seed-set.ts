/**
 * A frozen seed set: the library's confident examples of each kind, taken once per classifier version, with the
 * statistics that put their similarities and the prompt scores on one scale. A verdict is then a function of the image,
 * the committed config and this set, never of the live library. The scoring mirrors the tuner's (prototypes.ts) so a
 * verdict at runtime is the verdict the tuning table showed.
 */
import { decideKind, scoreKinds, type KindFacts, type KindVerdict, type PromptEmbeddings } from './classifier.js';
import type { KindClassifierConfig, PrototypeConfig } from './classifier-config.js';
import { IMAGE_KINDS, type ImageKind } from './kinds.js';
import {
    DUPLICATE_COSINE,
    MIN_SEEDS,
    measureColumn,
    meanOfTop,
    scorePrototypes,
    SEED_KINDS,
    toUnit,
    toZScore,
    type ColumnStats,
    type SeedKind,
} from './prototypes.js';

export interface SeedSetStats {
    /** The kinds with enough seeds to be scored by similarity; every other kind is scored by the prompts alone. */
    scored: SeedKind[];
    prototype: Partial<Record<SeedKind, ColumnStats>>;
    prompt: Record<ImageKind, ColumnStats>;
}

export interface FrozenSeed {
    id: string;
    kind: SeedKind;
    /** Unit length. */
    embedding: number[];
}

export interface SeedSet {
    stats: SeedSetStats;
    seeds: FrozenSeed[];
}

/** An image of the library as the snapshot sees it: its embedding and the seed rules it matches (the first decides). */
export interface SnapshotImage {
    id: string;
    embedding: number[];
    rules: readonly SeedKind[];
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

/**
 * Takes the seed set of a library: the seeds of every kind with enough of them, and the statistics of the
 * leave-one-out similarities and of the prompt scores over the whole library (exactly what the tuner z-scores with).
 */
export function buildSeedSet(images: readonly SnapshotImage[], promptRaws: readonly Record<ImageKind, number>[], config: PrototypeConfig): SeedSet {
    const { sims, seedCounts } = scorePrototypes(images, { method: 'knn', k: config.k });
    const scored = SEED_KINDS.filter((kind) => seedCounts[kind] >= MIN_SEEDS);
    const stats: SeedSetStats = {
        scored,
        prototype: Object.fromEntries(scored.map((kind) => [kind, measureColumn(sims.map((entry) => entry[kind]))])),
        prompt: Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, measureColumn(promptRaws.map((raw) => raw[kind]))])) as Record<ImageKind, ColumnStats>,
    };
    const seeds = images.flatMap((image) => {
        const kind = image.rules[0];

        return kind && scored.includes(kind) ? [{ id: image.id, kind, embedding: toUnit(image.embedding) }] : [];
    });

    return { stats, seeds };
}

/** Mean similarity of an image to the `k` nearest seeds of a kind: itself and same-kind near-duplicates left out. Null when none are left. */
function nearestSeeds(unit: readonly number[], selfId: string | null, seeds: readonly FrozenSeed[], k: number): number | null {
    const similarities = seeds.filter((seed) => seed.id !== selfId).map((seed) => dot(unit, seed.embedding));
    const usable = similarities.filter((similarity) => similarity < DUPLICATE_COSINE);

    return usable.length === 0 ? null : meanOfTop(usable, k);
}

/**
 * One score per kind, in z units, as the tuner's blend: a scored kind gets z(similarity to its nearest seeds) plus
 * the prompt weight times z(prompt score), and every other kind the weighted prompt term alone. `selfId` is the
 * image's own document, so a seed being classified again does not vote for itself.
 */
export function scoreWithSeedSet(
    embedding: readonly number[],
    selfId: string | null,
    promptRaw: Record<ImageKind, number>,
    set: SeedSet,
    config: PrototypeConfig,
): Record<ImageKind, number> {
    const unit = toUnit([...embedding]);

    return Object.fromEntries(
        IMAGE_KINDS.map((kind) => {
            const prompt = config.promptWeight * toZScore(promptRaw[kind], set.stats.prompt[kind]);
            const prototypeStats = (set.stats.scored as readonly string[]).includes(kind) ? set.stats.prototype[kind as SeedKind] : undefined;

            if (!prototypeStats) return [kind, config.promptWeight > 0 ? prompt : Number.NEGATIVE_INFINITY];

            const similarity = nearestSeeds(
                unit,
                selfId,
                set.seeds.filter((seed) => seed.kind === kind),
                config.k,
            );

            return [kind, (similarity === null ? 0 : toZScore(similarity, prototypeStats)) + prompt];
        }),
    ) as Record<ImageKind, number>;
}

/** The verdict of an image under a config with prototypes: the blended scores through the usual photo-biased decision. */
export function classifyWithSeedSet(
    embedding: readonly number[],
    selfId: string | null,
    prompts: PromptEmbeddings,
    facts: KindFacts,
    set: SeedSet,
    config: KindClassifierConfig & { prototypes: PrototypeConfig },
): KindVerdict {
    const promptRaw = scoreKinds(embedding, prompts, config.aggregate);

    return decideKind(scoreWithSeedSet(embedding, selfId, promptRaw, set, config.prototypes), facts, config);
}
