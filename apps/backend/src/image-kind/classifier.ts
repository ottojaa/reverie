import { matchesExactScreenResolution } from '../ocr/category-classifier';
import { KIND_CLASSIFIER, type KindAggregate, type KindClassifierConfig } from './classifier-config';
import { IMAGE_KINDS, PAPER_KINDS, type ImageKind } from './kinds';

/** Prompt embeddings (unit length) per kind. */
export type PromptEmbeddings = Record<ImageKind, number[][]>;

/** Camera evidence: facts only a camera leaves. A capture date is not one: phone screenshots and app-saved images carry it too. */
export type CameraFact = 'make' | 'model' | 'lens' | 'gps';

/** The camera evidence an image has, from which camera fields are present: the one place that list is built. */
export function toCameraFacts(present: { make: boolean; model: boolean; lens: boolean; gps: boolean }): CameraFact[] {
    return (['make', 'model', 'lens', 'gps'] as const).filter((fact) => present[fact]);
}

export interface KindFacts {
    /** The camera evidence the image has, from EXIF. Empty for a screenshot or a scan. */
    camera: readonly CameraFact[];
    /** A capture date alone: recorded for the comparison, never counted as camera evidence. */
    captureDate: boolean;
    width: number | null;
    height: number | null;
}

export interface KindSignals {
    camera: CameraFact[];
    captureDate: boolean;
    screenResolution: boolean;
    /** The best non-photo kind, and by how much it beats photo (negative: it does not). */
    runnerUp: ImageKind;
    margin: number;
    requiredMargin: number;
}

export interface KindVerdict {
    kind: ImageKind;
    /** The scores the decision used: calibrated, with the priors added. */
    scores: Record<ImageKind, number>;
    signals: KindSignals;
}

function dot(a: readonly number[], b: readonly number[]): number {
    let sum = 0;

    for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;

    return sum;
}

function combine(cosines: readonly number[], aggregate: KindAggregate): number {
    if (aggregate === 'max') return Math.max(...cosines);

    return cosines.reduce((sum, cosine) => sum + cosine, 0) / cosines.length;
}

/** Each kind's raw score: its prompts' cosines with the image, combined. No calibration, no priors. */
export function scoreKinds(embedding: readonly number[], prompts: PromptEmbeddings, aggregate: KindAggregate): Record<ImageKind, number> {
    return Object.fromEntries(
        IMAGE_KINDS.map((kind) => [
            kind,
            combine(
                prompts[kind].map((prompt) => dot(embedding, prompt)),
                aggregate,
            ),
        ]),
    ) as Record<ImageKind, number>;
}

/**
 * Picks a kind from raw scores. Photo-biased: camera evidence raises photo's score, and a non-photo kind wins only by
 * beating photo by a margin; a camera image that reads as paper needs a clearer one. A screen-exact size without camera
 * evidence raises screenshot. Calibration comes first, so priors and margins are in calibrated units.
 */
export function decideKind(raw: Record<ImageKind, number>, facts: KindFacts, config: KindClassifierConfig = KIND_CLASSIFIER): KindVerdict {
    const { thresholds } = config;
    const hasCamera = facts.camera.length > 0;
    const screenResolution = !hasCamera && facts.width !== null && facts.height !== null && matchesExactScreenResolution(facts.width, facts.height);
    const scores = Object.fromEntries(
        IMAGE_KINDS.map((kind) => [kind, (raw[kind] - config.calibration[kind].offset) / config.calibration[kind].scale]),
    ) as Record<ImageKind, number>;

    if (hasCamera) scores.photo += thresholds.cameraPrior;

    if (screenResolution) scores.screenshot += thresholds.screenPrior;

    const challengers = IMAGE_KINDS.filter((kind) => kind !== 'photo');
    const runnerUp = challengers.reduce((best, kind) => (scores[kind] > scores[best] ? kind : best));
    const margin = scores[runnerUp] - scores.photo;
    const requiredMargin = hasCamera && PAPER_KINDS.includes(runnerUp) ? Math.max(thresholds.paperOnCameraMargin, thresholds.margin) : thresholds.margin;

    return {
        kind: margin >= requiredMargin ? runnerUp : 'photo',
        scores,
        signals: { camera: [...facts.camera], captureDate: facts.captureDate, screenResolution, runnerUp, margin, requiredMargin },
    };
}

/** Scores an image embedding against the prompt embeddings (all unit length, so a cosine is a dot product) and picks a kind. */
export function classifyImageKind(
    embedding: readonly number[],
    prompts: PromptEmbeddings,
    facts: KindFacts,
    config: KindClassifierConfig = KIND_CLASSIFIER,
): KindVerdict {
    return decideKind(scoreKinds(embedding, prompts, config.aggregate), facts, config);
}
