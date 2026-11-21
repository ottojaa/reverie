import { IDENTITY_CALIBRATION, KIND_CLASSIFIER, type KindClassifierConfig } from '../image-kind/classifier-config.js';

/**
 * A classifier that scores by the prompts alone, in raw cosine units, so a test can steer a verdict with one axis per
 * kind and needs no seed set. The committed classifier scores by seeds and is tested where it is defined.
 */
export const PROMPT_ONLY_CLASSIFIER: KindClassifierConfig = {
    version: 'test-prompts',
    prompts: KIND_CLASSIFIER.prompts,
    aggregate: 'max',
    calibration: IDENTITY_CALIBRATION,
    thresholds: { cameraPrior: 0.03, screenPrior: 0.03, margin: 0.02, paperOnCameraMargin: 0.04 },
};
