import { IMAGE_KINDS, type ImageKind } from './kinds';

/**
 * The classifier: the prompts an image is compared with, how a kind's prompts are combined, how each kind's score is
 * put on a common scale, and the thresholds. All of it decides verdicts, so a change to any part gets a new
 * `version`: it is stored on every verdict, and the backfill re-classifies verdicts of another version.
 */

export type KindAggregate = 'mean' | 'max';

/** A kind's score becomes (raw - offset) / scale. Offset 0 and scale 1 leave the raw cosine alone. */
export interface KindCalibration {
    offset: number;
    scale: number;
}

/** Thresholds in calibrated units (raw cosine units when the calibration is the identity). */
export interface KindThresholds {
    /** Added to photo's score when the image carries camera evidence (make, model, lens or GPS; a capture date is not). */
    cameraPrior: number;
    /** Added to screenshot's score when the size is an exact device resolution and there is no camera evidence. */
    screenPrior: number;
    /** How far a non-photo kind must beat photo to win. Photo wins every closer call. */
    margin: number;
    /** The same for document and receipt when the image carries camera evidence: paper photographed with a camera. */
    paperOnCameraMargin: number;
}

/**
 * Scoring by similarity to a frozen set of the library's own confident examples (see seed-set.ts), beside the prompts.
 * Each kind's score is z(mean similarity to its `k` nearest seeds) + `promptWeight` * z(prompt score), with the z
 * statistics frozen in the seed set. The calibration of such a config is the identity.
 */
export interface PrototypeConfig {
    k: number;
    promptWeight: number;
}

export interface KindClassifierConfig {
    version: string;
    prototypes?: PrototypeConfig;
    prompts: Record<ImageKind, readonly string[]>;
    aggregate: KindAggregate;
    calibration: Record<ImageKind, KindCalibration>;
    thresholds: KindThresholds;
}

export const IDENTITY_CALIBRATION: Record<ImageKind, KindCalibration> = Object.fromEntries(
    IMAGE_KINDS.map((kind) => [kind, { offset: 0, scale: 1 }]),
) as Record<ImageKind, KindCalibration>;

/**
 * v2 prompts, SigLIP style (English; the model's text tower is trained on short captions). Several per kind and the
 * score is the best match (`max`), so a kind that looks like several different things (a phone screen, a terminal,
 * a browser) is recognised as any of them without the others diluting it.
 *
 * Paper is split by shape, because v1's receipt prompts pulled every printed page toward receipt: a document is a
 * multi-line statement, letter, form, certificate or invoice (a scan or a photo of paper), a receipt is a narrow till slip.
 */
export const V2_PROMPTS: Record<ImageKind, readonly string[]> = {
    photo: [
        'a photo taken with a camera',
        'a photograph of people, a place or an object',
        'a snapshot of an everyday scene',
        'a candid photo of a person or a pet',
        'a landscape or a travel photo',
        'a photo of food on a table',
    ],
    screenshot: [
        'a screenshot of a phone screen with an app',
        'a screenshot of a mobile chat conversation with message bubbles',
        'a screenshot of a phone settings screen or a notification',
        'a screenshot of a desktop computer window with a toolbar and menus',
        'a screenshot of a web page in a browser',
        'a screenshot of a terminal window with command line text',
        'a screenshot of a code editor showing source code',
    ],
    document: [
        'a scan of a printed document',
        'a photo of a sheet of paper with printed text',
        'a bank statement with a table of transactions and account details',
        'an investment statement with holdings, quantities and values',
        'a letter with a sender address, a date and paragraphs of text',
        'a filled-in form with fields and boxes',
        'a certificate or a diploma',
        'an invoice with a table of line items and a company letterhead',
        'a page of a book or a magazine',
    ],
    receipt: [
        'a narrow shop receipt from a cash register',
        'a crumpled till receipt with a short list of items and a total',
        'a thermal paper receipt lying on a table',
    ],
    diagram: [
        'a diagram with boxes and arrows',
        'a flowchart or an architecture diagram',
        'a bar chart or a line graph with labelled axes',
        'an infographic',
        'a logo or a vector illustration',
    ],
    other: ['a meme with text over a picture', 'a cartoon or a drawing', 'an abstract pattern or a texture', 'a product picture on a plain background'],
};

/**
 * The committed classifier: the winning candidate of the tuning rounds on the real library (set g: nearest 3 seeds
 * plus the prompts at weight 0.25, scoring 0 privacy leaks, 40 of 45 screenshots and 12 of 12 paper at margin 0.5,
 * the strictest margin that passed). Thresholds are in z units. The seeds and the z statistics are not here: they
 * come from the seed set stored for this version (`image_kind_seed_sets`, taken once on the server by
 * scripts/snapshot-image-kind-seeds.ts), so a verdict never moves as the library grows. Without a seed set for this
 * version and image model nothing is classified.
 */
export const KIND_CLASSIFIER: KindClassifierConfig = {
    version: 'v2',
    prompts: V2_PROMPTS,
    aggregate: 'max',
    calibration: IDENTITY_CALIBRATION,
    prototypes: { k: 3, promptWeight: 0.25 },
    thresholds: { cameraPrior: 0.75, screenPrior: 0.5, margin: 0.5, paperOnCameraMargin: 1 },
};

export const KIND_CLASSIFIER_VERSION = KIND_CLASSIFIER.version;

/** Every prompt text of a config in a fixed order (kind order, then prompt order), with the kind it belongs to. */
export function listPrompts(config: Pick<KindClassifierConfig, 'prompts'>): { kind: ImageKind; text: string }[] {
    return IMAGE_KINDS.flatMap((kind) => config.prompts[kind].map((text) => ({ kind, text })));
}
