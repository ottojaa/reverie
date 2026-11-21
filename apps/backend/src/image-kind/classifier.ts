import { matchesExactScreenResolution } from '../ocr/category-classifier';
import { IMAGE_KINDS, KIND_THRESHOLDS, PAPER_KINDS, type ImageKind } from './kinds';

/** Prompt embeddings (unit length) per kind. */
export type PromptEmbeddings = Record<ImageKind, number[][]>;

export type CameraFact = 'make' | 'model' | 'lens' | 'gps' | 'capture_date';

export interface KindFacts {
    /** The camera facts the document has, from EXIF. Empty for a screenshot or a scan. */
    camera: readonly CameraFact[];
    width: number | null;
    height: number | null;
}

export interface KindSignals {
    camera: CameraFact[];
    screenResolution: boolean;
    /** The best non-photo kind, and by how much it beats photo (negative: it does not). */
    runnerUp: ImageKind;
    margin: number;
    requiredMargin: number;
}

export interface KindVerdict {
    kind: ImageKind;
    scores: Record<ImageKind, number>;
    signals: KindSignals;
}

function dot(a: readonly number[], b: readonly number[]): number {
    let sum = 0;

    for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;

    return sum;
}

function meanCosine(embedding: readonly number[], prompts: readonly number[][]): number {
    return prompts.reduce((sum, prompt) => sum + dot(embedding, prompt), 0) / prompts.length;
}

/**
 * Scores an image embedding against the prompt embeddings (all unit length, so a cosine is a dot product) and picks a
 * kind. Photo-biased: camera facts raise photo's score, and a non-photo kind wins only by beating photo by a margin;
 * a camera image that reads as paper needs a clearer one. A screen-exact size without camera facts raises screenshot.
 */
export function classifyImageKind(embedding: readonly number[], prompts: PromptEmbeddings, facts: KindFacts): KindVerdict {
    const hasCamera = facts.camera.length > 0;
    const screenResolution = !hasCamera && facts.width !== null && facts.height !== null && matchesExactScreenResolution(facts.width, facts.height);
    const scores = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, meanCosine(embedding, prompts[kind])])) as Record<ImageKind, number>;

    if (hasCamera) scores.photo += KIND_THRESHOLDS.cameraPrior;

    if (screenResolution) scores.screenshot += KIND_THRESHOLDS.screenPrior;

    const challengers = IMAGE_KINDS.filter((kind) => kind !== 'photo');
    const runnerUp = challengers.reduce((best, kind) => (scores[kind] > scores[best] ? kind : best));
    const margin = scores[runnerUp] - scores.photo;
    const requiredMargin = hasCamera && PAPER_KINDS.includes(runnerUp) ? KIND_THRESHOLDS.paperOnCameraMargin : KIND_THRESHOLDS.margin;

    return {
        kind: margin >= requiredMargin ? runnerUp : 'photo',
        scores,
        signals: { camera: [...facts.camera], screenResolution, runnerUp, margin, requiredMargin },
    };
}
