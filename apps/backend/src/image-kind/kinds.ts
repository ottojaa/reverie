/**
 * What kind of image is this: the kinds, the flip switch, and what a verdict stands for. The prompts, aggregation,
 * calibration and thresholds that make up the classifier live in classifier-config.ts.
 */

export const IMAGE_KINDS = ['photo', 'screenshot', 'document', 'receipt', 'diagram', 'other'] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * Shadow mode: verdicts are stored beside `document_category` and change nothing. A later, separate change sets this
 * to true once the verdicts have been compared with the real library. It is a constant, not an environment flag, so
 * switching it on is a reviewed change. See isKindFlipActive for the other condition.
 */
export const IMAGE_KIND_DECIDES_CATEGORY = false;

/** The kinds that read as paper. A camera image of paper is still held back from Claude by its EXIF. */
export const PAPER_KINDS: readonly ImageKind[] = ['document', 'receipt'];

/** The `document_category` a verdict stands for when the flip is on. */
export const KIND_TO_CATEGORY: Record<ImageKind, string> = {
    photo: 'photo',
    screenshot: 'screenshot',
    document: 'other',
    receipt: 'receipt',
    diagram: 'graphic',
    other: 'other',
};

/**
 * Categories the OCR heuristics produce. A verdict only replaces one of these (or null), never a category the LLM
 * chose such as `invoice`.
 */
export const REPLACEABLE_CATEGORIES: readonly string[] = ['photo', 'screenshot', 'graphic', 'other'];
