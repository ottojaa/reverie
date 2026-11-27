import type { ProcessingLane } from '@reverie/shared';
import { env } from '../config/env.js';

/** Arguments of PaddleOCR's `predict()`, sent with a request and applied to that request only. */
interface PredictSettings {
    use_doc_unwarping: boolean;
    use_doc_orientation_classify: boolean;
    text_det_limit_side_len: number;
    text_det_limit_type: 'max';
}

/**
 * A background document is read faster, at a slightly lower word recall, so that a normal one queued behind it waits
 * less. A normal document gets none: the pipeline's own settings.
 */
export function toPredictSettings(lane: ProcessingLane): PredictSettings | undefined {
    if (lane === 'normal') return undefined;

    return {
        use_doc_unwarping: env.OCR_BACKGROUND_DOC_UNWARPING,
        use_doc_orientation_classify: env.OCR_BACKGROUND_DOC_ORIENTATION,
        text_det_limit_side_len: env.OCR_BACKGROUND_DET_MAX_SIDE,
        // Without it the side length is a minimum (the pipeline's default type), which would only enlarge small images.
        text_det_limit_type: 'max',
    };
}
