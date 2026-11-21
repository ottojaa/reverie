import { z } from 'zod';
import type { KindCalibration, KindClassifierConfig } from './classifier-config.js';
import { IMAGE_KINDS, type ImageKind } from './kinds.js';

/** reverie-ml embeds at most this many texts per request. */
const MAX_PROMPTS = 64;

const CalibrationSchema = z.object({ offset: z.number(), scale: z.number().positive() });

/**
 * How each kind's raw score is put on a common scale:
 * - `none`: the raw cosine.
 * - `offset`: minus the kind's mean over the library (centres every kind on zero, keeps cosine units).
 * - `zscore`: minus the mean, divided by the standard deviation (centres and puts every kind in the same units).
 * - an explicit offset and scale per kind: what a tuned set commits once the numbers are chosen.
 */
const CalibrationModeSchema = z.union([z.enum(['none', 'offset', 'zscore']), z.record(z.string(), CalibrationSchema)]);

/** A prompt set a tuning run scores: the same knobs as the committed classifier, read from a JSON file. */
export const PromptSetSchema = z.object({
    name: z.string().min(1),
    aggregate: z.enum(['mean', 'max']),
    calibration: CalibrationModeSchema,
    thresholds: z.object({ cameraPrior: z.number(), screenPrior: z.number(), margin: z.number(), paperOnCameraMargin: z.number() }),
    prompts: z.record(z.string(), z.array(z.string().min(1)).min(1)),
    /** Margins to try in the grid, in the calibrated units. Defaults by calibration. */
    margins: z.array(z.number()).optional(),
    /**
     * Scores kinds by similarity to library images known to be that kind (see prototypes.ts), alone or beside the
     * prompts. Each source is z-scored by the run itself, so `calibration` must be `none` for such a set. `ks` and
     * `promptWeights` add variants to the margin grid.
     */
    prototypes: z
        .object({
            method: z.enum(['centroid', 'knn']),
            k: z.number().int().positive().optional(),
            promptWeight: z.number().min(0),
            ks: z.array(z.number().int().positive()).optional(),
            promptWeights: z.array(z.number().min(0)).optional(),
        })
        .optional(),
});

export type PromptSet = Omit<z.infer<typeof PromptSetSchema>, 'calibration' | 'prompts'> & {
    calibration: 'none' | 'offset' | 'zscore' | Record<ImageKind, KindCalibration>;
    prompts: Record<ImageKind, string[]>;
};

function assertEveryKind(record: Record<string, unknown>, what: string): void {
    const keys = Object.keys(record).sort().join(',');

    if (keys !== [...IMAGE_KINDS].sort().join(',')) throw new Error('Invalid prompt set: ' + what + ' must have exactly the kinds ' + IMAGE_KINDS.join(', '));
}

/** Parses and checks a prompt-set file's JSON. The error names what is wrong, never the file's content. */
export function parsePromptSet(json: unknown): PromptSet {
    const parsed = PromptSetSchema.safeParse(json);

    if (!parsed.success) throw new Error('Invalid prompt set: ' + parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; '));

    const set = parsed.data;

    assertEveryKind(set.prompts, 'prompts');

    if (typeof set.calibration !== 'string') assertEveryKind(set.calibration, 'calibration');

    if (set.prototypes && set.calibration !== 'none') throw new Error('Invalid prompt set: calibration must be none when prototypes are set');

    const count = Object.values(set.prompts).reduce((sum, list) => sum + list.length, 0);

    if (count > MAX_PROMPTS) throw new Error('Invalid prompt set: at most ' + MAX_PROMPTS + ' prompts in total, got ' + count);

    return set as PromptSet;
}

export interface KindStats {
    mean: number;
    std: number;
}

/** The mean and standard deviation of each kind's raw score over the library: what `offset` and `zscore` calibrate with. */
export function measureKindStats(raws: readonly Record<ImageKind, number>[]): Record<ImageKind, KindStats> {
    return Object.fromEntries(
        IMAGE_KINDS.map((kind) => {
            const values = raws.map((raw) => raw[kind]);
            const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
            const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length || 1);

            return [kind, { mean, std: Math.sqrt(variance) }];
        }),
    ) as Record<ImageKind, KindStats>;
}

/** The offset and scale per kind a set's calibration mode gives for a library whose raw scores were measured as `stats`. */
export function resolveCalibration(mode: PromptSet['calibration'], stats: Record<ImageKind, KindStats>): Record<ImageKind, KindCalibration> {
    if (typeof mode !== 'string') return mode;

    return Object.fromEntries(
        IMAGE_KINDS.map((kind) => {
            if (mode === 'none') return [kind, { offset: 0, scale: 1 }];

            if (mode === 'offset') return [kind, { offset: stats[kind].mean, scale: 1 }];

            // A kind whose score never varies would divide by zero; leave its scale alone.
            return [kind, { offset: stats[kind].mean, scale: stats[kind].std || 1 }];
        }),
    ) as Record<ImageKind, KindCalibration>;
}

export function toConfig(set: PromptSet, calibration: Record<ImageKind, KindCalibration>): KindClassifierConfig {
    return { version: set.name, prompts: set.prompts, aggregate: set.aggregate, calibration, thresholds: set.thresholds };
}

const RAW_MARGINS = [0.01, 0.02, 0.03, 0.04, 0.06];
const Z_MARGINS = [0.25, 0.5, 0.75, 1, 1.5];

/** The margins the grid tries: the set's own, or a default that fits its units (z units after a z-score, cosine units otherwise). */
export function marginsFor(set: PromptSet): number[] {
    return set.margins ?? (set.calibration === 'zscore' || set.prototypes ? Z_MARGINS : RAW_MARGINS);
}

/** The values after each `--prompts` flag of a command line. */
export function parsePromptArgs(argv: readonly string[]): string[] {
    return argv.flatMap((arg, i) => (arg === '--prompts' && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
}
