/**
 * The prototype side of a tuning run: scores the library against its own seeds for each variant of a prototype set
 * (neighbour count and prompt weight), in memory. Seeds and prototypes are never printed, only counts.
 */
import type { ComparisonRow } from './compare-report.js';
import { toCameraFacts } from './classifier.js';
import { IMAGE_KINDS, type ImageKind } from './kinds.js';
import { blendScores, matchSeedRules, MIN_SEEDS, scorePrototypes, SEED_KINDS, type PrototypeMethod, type SeedKind } from './prototypes.js';

export type Raw = Record<ImageKind, number>;

export interface PrototypeSettings {
    method: PrototypeMethod;
    /** Neighbours averaged by `knn`. */
    k?: number | undefined;
    promptWeight: number;
    /** Neighbour counts to try beside `k`. */
    ks?: number[] | undefined;
    /** Prompt weights to try beside `promptWeight`. */
    promptWeights?: number[] | undefined;
}

/** What the seed rules and the scoring read of a library image. */
export interface PrototypeImage {
    filename: string;
    category: string | null;
    hasMeaningfulText: boolean;
    embedding: number[];
    width: number | null;
    height: number | null;
    capture: ComparisonRow['capture'];
}

export interface PrototypeVariant {
    /** What differs from the set's base, for the grid lines: neighbour count and prompt weight. */
    label: string;
    raws: Raw[];
}

const DEFAULT_K = 3;

/** The prompt weights a set tries, base first. */
export const promptWeightsOf = (settings: PrototypeSettings): number[] => [settings.promptWeight, ...(settings.promptWeights ?? [])];

const ksOf = (settings: PrototypeSettings): number[] => (settings.method === 'knn' ? [settings.k ?? DEFAULT_K, ...(settings.ks ?? [])] : [DEFAULT_K]);

const unique = (values: number[]) => [...new Set(values)];

/** Scores the library for every (k, prompt weight) the set tries, the base first, plus the notes for the report. */
export function scoreVariants(
    images: readonly PrototypeImage[],
    promptRaws: readonly Raw[] | null,
    settings: PrototypeSettings,
): { variants: PrototypeVariant[]; notes: string[] } {
    const seeded = images.map((image) => ({
        embedding: image.embedding,
        rules: matchSeedRules({ ...image, camera: toCameraFacts(image.capture) }),
    }));
    const zero = images.map(() => Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, 0])) as Raw);
    const variants: PrototypeVariant[] = [];
    let notes: string[] = [];

    for (const k of unique(ksOf(settings))) {
        const scores = scorePrototypes(seeded, { method: settings.method, k });

        if (variants.length === 0)
            notes = formatNotes(scores, settings, [
                ...formatSeedMix(
                    images,
                    seeded.map((entry) => entry.rules[0] ?? null),
                ),
            ]);

        for (const promptWeight of unique(promptWeightsOf(settings))) {
            const label = (settings.method === 'knn' ? `k=${k} ` : '') + `promptWeight=${promptWeight}`;

            variants.push({ label, raws: blendScores(scores.sims, promptRaws ?? zero, promptWeight) });
        }
    }

    return { variants, notes };
}

function formatNotes(scores: ReturnType<typeof scorePrototypes>, settings: PrototypeSettings, seedMix: string[]): string[] {
    const kind = settings.method === 'knn' ? `knn k=${settings.k ?? DEFAULT_K}` : 'centroid';

    return [
        `Prototypes, leave-one-out (${kind}, prompt weight ${settings.promptWeight}). Seeds found without the classifier:`,
        ...SEED_KINDS.map(
            (name) =>
                `  ${name.padEnd(12)}${scores.seedCounts[name]} seed(s)${scores.seedCounts[name] >= MIN_SEEDS ? '' : `  (fewer than ${MIN_SEEDS}: not scored by prototypes)`}`,
        ),
        `  ${scores.overlaps} image(s) match more than one seed rule (the first rule wins)`,
        `  ${scores.imagesWithTwins} image(s) had a near-identical same-kind seed left out of their own score`,
        ...seedMix,
        promptWeightsOf(settings).includes(0)
            ? 'Diagram and other have no seeds, and a kind with fewer than the minimum has none scored: at prompt weight 0 they cannot be chosen.'
            : 'Diagram, other and any kind with too few seeds are scored by the prompts alone.',
    ];
}

/** Seed purity, counts only: the language model's category of each seed kind's images, and how screenshot seeds were found. */
function* formatSeedMix(images: readonly PrototypeImage[], seedKinds: (SeedKind | null)[]): Generator<string> {
    yield '  What the seeds are, by the language model category (counts only; "none" = no category yet):';

    for (const kind of SEED_KINDS) {
        const counts = new Map<string, number>();

        images.forEach((image, i) => {
            if (seedKinds[i] !== kind) return;

            counts.set(image.category ?? 'none', (counts.get(image.category ?? 'none') ?? 0) + 1);
        });

        const mix = [...counts].sort((a, b) => b[1] - a[1]).map(([category, count]) => `${category} ${count}`);

        yield `    ${kind.padEnd(12)}${mix.join(', ') || '-'}`;
    }

    const byName = images.filter((image, i) => seedKinds[i] === 'screenshot' && /^screenshot[_ -]/i.test(image.filename)).length;
    const total = seedKinds.filter((kind) => kind === 'screenshot').length;

    yield `    screenshot seeds found by filename: ${byName}, by screen size only: ${total - byName}`;
}
