/**
 * Prototype scoring for the tuning run: how close an image sits to the library's own confident examples of each kind,
 * instead of to a text prompt. Seeds are chosen from facts that do not come from the classifier or from the
 * `screenshot` category (which is the flip bar's truth): a screenshot filename or screen size, camera evidence, the
 * LLM's paper categories. Every score is leave-one-out: an image never votes for itself, nor does a near-duplicate of it.
 */
import { matchesExactScreenResolution } from '../ocr/category-classifier.js';
import type { CameraFact } from './classifier.js';
import { PAPER_CATEGORIES } from './compare-report.js';
import { IMAGE_KINDS, type ImageKind } from './kinds.js';

export const SEED_KINDS = ['photo', 'screenshot', 'document', 'receipt'] as const satisfies readonly ImageKind[];

export type SeedKind = (typeof SEED_KINDS)[number];

/** Two embeddings this close are the same picture (a copy, a re-upload): the twin does not count as independent evidence. */
export const DUPLICATE_COSINE = 0.99;

/** A kind with fewer seeds than this is not scored by prototypes: a prototype of one or two images is noise. */
export const MIN_SEEDS = 3;

export interface SeedFacts {
    filename: string;
    category: string | null;
    hasMeaningfulText: boolean;
    camera: readonly CameraFact[];
    width: number | null;
    height: number | null;
}

/** The seed rules an image matches, in precedence order: the first one decides its seed kind. */
export function matchSeedRules(facts: SeedFacts): SeedKind[] {
    const hasCamera = facts.camera.length > 0;
    const isScreen =
        /^screenshot[_ -]/i.test(facts.filename) || (facts.width !== null && facts.height !== null && matchesExactScreenResolution(facts.width, facts.height));
    const rules: [SeedKind, boolean][] = [
        ['receipt', facts.category === 'receipt'],
        ['document', facts.category !== null && PAPER_CATEGORIES.includes(facts.category)],
        ['screenshot', isScreen && !hasCamera],
        ['photo', hasCamera && !facts.hasMeaningfulText],
    ];

    return rules.filter(([, matches]) => matches).map(([kind]) => kind);
}

export const toSeedKind = (facts: SeedFacts): SeedKind | null => matchSeedRules(facts)[0] ?? null;

export type PrototypeMethod = 'centroid' | 'knn';

export interface PrototypeOptions {
    method: PrototypeMethod;
    /** Neighbours averaged by `knn`. Ignored by `centroid`. */
    k: number;
}

export interface PrototypeSims {
    /** Per image, the similarity to each seed kind's prototype; null where the kind has no seed left once the image and its twins are excluded. */
    sims: Record<SeedKind, number | null>[];
    seedCounts: Record<SeedKind, number>;
    /** Images that match more than one seed rule (the first rule wins). */
    overlaps: number;
    /** Images that had at least one same-kind near-duplicate seed excluded from their own score. */
    imagesWithTwins: number;
}

export function toUnit(vector: readonly number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;

    return vector.map((value) => value / norm);
}

function dot(a: readonly number[], b: readonly number[]): number {
    let sum = 0;

    for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;

    return sum;
}

function toGram(embeddings: readonly number[][]): number[][] {
    return embeddings.map((a) => embeddings.map((b) => dot(a, b)));
}

function centroidCosine(gram: number[][], i: number, seeds: readonly number[]): number {
    const along = seeds.reduce((sum, j) => sum + gram[i]![j]!, 0);
    const norm = Math.sqrt(seeds.reduce((sum, a) => sum + seeds.reduce((inner, b) => inner + gram[a]![b]!, 0), 0));

    return along / (norm || 1);
}

/** The mean of the `k` largest similarities (at least one). */
export function meanOfTop(similarities: readonly number[], k: number): number {
    const top = [...similarities].sort((a, b) => b - a).slice(0, Math.max(1, k));

    return top.reduce((sum, value) => sum + value, 0) / top.length;
}

function neighbourCosine(gram: number[][], i: number, seeds: readonly number[], k: number): number {
    return meanOfTop(
        seeds.map((j) => gram[i]![j]!),
        k,
    );
}

/** Each image's similarity to the prototype of each seed kind, leave-one-out. Embeddings are normalised to unit length here. */
export function scorePrototypes(images: readonly { embedding: number[]; rules: readonly SeedKind[] }[], options: PrototypeOptions): PrototypeSims {
    const gram = toGram(images.map((image) => toUnit(image.embedding)));
    const seedsOf = Object.fromEntries(SEED_KINDS.map((kind) => [kind, images.flatMap((image, i) => (image.rules[0] === kind ? [i] : []))])) as Record<
        SeedKind,
        number[]
    >;
    const scored = SEED_KINDS.filter((kind) => seedsOf[kind].length >= MIN_SEEDS);
    let imagesWithTwins = 0;
    const sims = images.map((_, i) => {
        let hadTwin = false;
        const entry = Object.fromEntries(
            SEED_KINDS.map((kind) => {
                if (!scored.includes(kind)) return [kind, null];

                const own = seedsOf[kind].filter((j) => j !== i);
                const usable = own.filter((j) => gram[i]![j]! < DUPLICATE_COSINE);

                hadTwin ||= usable.length < own.length;

                if (usable.length === 0) return [kind, null];

                return [kind, options.method === 'centroid' ? centroidCosine(gram, i, usable) : neighbourCosine(gram, i, usable, options.k)];
            }),
        ) as Record<SeedKind, number | null>;

        if (hadTwin) imagesWithTwins += 1;

        return entry;
    });

    return {
        sims,
        seedCounts: Object.fromEntries(SEED_KINDS.map((kind) => [kind, seedsOf[kind].length])) as Record<SeedKind, number>,
        overlaps: images.filter((image) => image.rules.length > 1).length,
        imagesWithTwins,
    };
}

export interface ColumnStats {
    mean: number;
    std: number;
}

/** Mean and population standard deviation of the present values; a flat column has std 1 so a z-score is just the difference. */
export function measureColumn(values: readonly (number | null)[]): ColumnStats {
    const present = values.filter((value): value is number => value !== null);
    const mean = present.reduce((sum, value) => sum + value, 0) / (present.length || 1);
    const std = Math.sqrt(present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (present.length || 1)) || 1;

    return { mean, std };
}

export const toZScore = (value: number, { mean, std }: ColumnStats): number => (value - mean) / std;

function toZ(values: readonly (number | null)[]): (number | null)[] {
    const stats = measureColumn(values);

    return values.map((value) => (value === null ? null : toZScore(value, stats)));
}

/**
 * One score per kind and image, in z units. A seeded kind scores its prototype similarity, z-scored over the library,
 * plus `promptWeight` times its prompt score z-scored the same way (the two live on scales about five times apart). A
 * kind without seeds (diagram, other) scores only its prompt term, and with no prompt weight it cannot win at all:
 * a doubtful image has to stay photo, never drift to a kind nothing was learned about. A missing term adds nothing.
 */
export function blendScores(
    sims: readonly Record<SeedKind, number | null>[],
    promptRaws: readonly Record<ImageKind, number>[],
    promptWeight: number,
): Record<ImageKind, number>[] {
    const zPrototype = Object.fromEntries(SEED_KINDS.map((kind) => [kind, toZ(sims.map((entry) => entry[kind]))])) as Record<SeedKind, (number | null)[]>;
    const zPrompt = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, toZ(promptRaws.map((raw) => raw[kind]))])) as Record<ImageKind, (number | null)[]>;

    return promptRaws.map((_, i) => {
        const entries = IMAGE_KINDS.map((kind) => {
            const prompt = promptWeight * (zPrompt[kind][i] ?? 0);
            const prototype = zPrototype[kind as SeedKind];

            // A kind with no prototype scores (no seeds, or too few) keeps only its prompt term, or cannot win at all.
            if (!prototype || prototype.every((value) => value === null)) return [kind, promptWeight > 0 ? prompt : Number.NEGATIVE_INFINITY];

            return [kind, (prototype[i] ?? 0) + prompt];
        });

        return Object.fromEntries(entries) as Record<ImageKind, number>;
    });
}
