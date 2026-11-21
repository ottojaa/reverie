/**
 * What kind of image is this: the kinds, the flip switch, and what a verdict stands for. The prompts, aggregation,
 * calibration and thresholds that make up the classifier live in classifier-config.ts.
 */

export const IMAGE_KINDS = ['photo', 'screenshot', 'document', 'receipt', 'diagram', 'other'] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * The flip: a stored verdict decides an image's `document_category`, and the embed worker (not OCR) queues the image's
 * LLM job once it has a kind. Switching it is a reviewed change, so it is a constant, not an environment flag. It is
 * active only with a local ML service (see isKindFlipActive): without one the OCR heuristics decide, as they did
 * before verdicts existed. Setting it back to false returns to shadow mode, where verdicts are stored and change
 * nothing; scripts/apply-image-kinds.ts --undo puts the heuristic categories back.
 */
export const IMAGE_KIND_DECIDES_CATEGORY = true;

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
