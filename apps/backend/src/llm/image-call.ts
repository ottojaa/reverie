/**
 * The one call that sees an image together with its OCR text, and the preparation of the image for it. Callers have
 * already decided the image may go (see decideImageLook): nothing here checks privacy or whether it is a photo.
 */
import sharp from 'sharp';
import { getProvider } from './provider-config';
import type { ImageCallResult, LlmCallOptions, PreparedImage } from './provider';
import type { LlmPrompt } from './types';

export type { ImageCallResult, PreparedImage } from './provider';

/**
 * Longest edge of the image sent. A screenshot or page at this size is still readable by eye, and costs about 1.5k
 * input tokens (a fraction of a cent at Haiku 5.5 prices). Larger sizes add cost for little: the OCR text is sent
 * too and carries the fine print. A 4000 px scan would otherwise cost several times more and upload megabytes.
 */
export const IMAGE_LONG_EDGE_PX = 1568;

const JPEG_QUALITY = 85;

/**
 * Downscales to IMAGE_LONG_EDGE_PX (never up), turns it upright by its EXIF orientation, and re-encodes as JPEG with
 * transparency flattened onto white. Re-encoding drops the EXIF block, so no GPS or camera data leaves with the pixels.
 */
export async function prepareImageForModel(file: Buffer): Promise<PreparedImage> {
    const { data, info } = await sharp(file, { failOn: 'none' })
        .rotate()
        .resize({ width: IMAGE_LONG_EDGE_PX, height: IMAGE_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });

    return { base64: data.toString('base64'), mediaType: 'image/jpeg', width: info.width, height: info.height };
}

/** Sends the image and its prompt to the image capability's provider. */
export async function understandImage(image: PreparedImage, prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<ImageCallResult> {
    return (await getProvider('image')).understand(image, prompt, options);
}
