/**
 * What kind of image is this: the kinds, the prompts the image embedding is compared with, and the thresholds.
 *
 * The prompts and thresholds together make up the classifier. Change either and bump KIND_CLASSIFIER_VERSION: it is
 * stored on every verdict, and the backfill re-classifies any verdict of another version.
 */

export const IMAGE_KINDS = ['photo', 'screenshot', 'document', 'receipt', 'diagram', 'other'] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

export const KIND_CLASSIFIER_VERSION = 'v1';

/**
 * Shadow mode: verdicts are stored beside `document_category` and change nothing. A later, separate change sets this
 * to true once the verdicts have been compared with the real library. It is a constant, not an environment flag, so
 * switching it on is a reviewed change. See isKindFlipActive for the other condition.
 */
export const IMAGE_KIND_DECIDES_CATEGORY = false;

/** English prompts per kind, SigLIP style. A kind's score is the mean cosine of its prompts. */
export const KIND_PROMPTS: Record<ImageKind, readonly string[]> = {
    photo: ['a photo taken with a camera', 'a photograph of people, a place or an object', 'a snapshot of an everyday scene'],
    screenshot: [
        'a screenshot of a computer or phone screen',
        'a screenshot of an app window with buttons, menus and text',
        'a screenshot of a terminal or a code editor',
    ],
    document: [
        'a scan of a printed document',
        'a photo of a sheet of paper with printed text',
        'a letter, a contract or a form on paper',
        'a page of a book or a magazine',
    ],
    receipt: ['a photo of a shop receipt', 'a printed receipt with a list of items, prices and a total', 'an invoice or a bill'],
    diagram: ['a diagram with boxes and arrows', 'a chart or a graph with labelled axes', 'an infographic', 'a logo or a vector illustration'],
    other: ['a meme with text over a picture', 'a cartoon or a drawing', 'an abstract pattern or a texture', 'a product picture on a plain background'],
};

/**
 * Thresholds, in cosine units (image-text cosines of the SigLIP2 model sit around 0.05 to 0.25). Starting points to be
 * tuned from the comparison script's output on the real library, like the search floors in reverie-ml's README.
 */
export const KIND_THRESHOLDS = {
    /** Score added to photo when the image carries camera facts (make, model, lens, GPS, capture date). */
    cameraPrior: 0.03,
    /** Score added to screenshot when the size is an exact device resolution and there are no camera facts. */
    screenPrior: 0.03,
    /** How far a non-photo kind must beat photo to win. Photo wins every closer call. */
    margin: 0.02,
    /** The same for document and receipt when the image carries camera facts: paper photographed with a camera. */
    paperOnCameraMargin: 0.04,
} as const;

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
