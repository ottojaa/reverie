import sharp from 'sharp';
import type { ImageSize, PreprocessingOptions } from './types';
import { OCR_LIMITS } from './types';

/**
 * Image Preprocessor for OCR
 *
 * Optimizes images before OCR processing:
 * - Convert to grayscale (improves accuracy)
 * - Normalize contrast
 * - Resize if too large
 * - Remove noise
 */

const DEFAULT_OPTIONS: PreprocessingOptions = {
    maxWidth: OCR_LIMITS.maxImageWidth,
    grayscale: true,
    normalizeContrast: true,
    removeNoise: false, // Disabled by default as it can sometimes hurt quality
};

/**
 * Preprocess an image buffer for optimal OCR results
 */
export async function preprocessImage(buffer: Buffer, options: PreprocessingOptions = {}): Promise<Buffer> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    let pipeline = sharp(buffer);

    // Resize if too large (maintain aspect ratio)
    if (opts.maxWidth) {
        pipeline = pipeline.resize({
            width: opts.maxWidth,
            height: opts.maxWidth,
            fit: 'inside',
            withoutEnlargement: true,
        });
    }

    // Convert to grayscale for better OCR
    if (opts.grayscale) {
        pipeline = pipeline.grayscale();
    }

    // Normalize/enhance contrast
    if (opts.normalizeContrast) {
        pipeline = pipeline.normalize();
    }

    // Apply median filter to reduce noise (optional)
    if (opts.removeNoise) {
        pipeline = pipeline.median(3);
    }

    // Output as PNG for lossless processing
    pipeline = pipeline.png();

    return pipeline.toBuffer();
}

/**
 * Get image dimensions from buffer
 */
export async function getImageSize(buffer: Buffer): Promise<ImageSize> {
    const metadata = await sharp(buffer).metadata();

    return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
    };
}

/**
 * Check if a file is an image that can be processed
 */
export function isProcessableImage(mimeType: string): boolean {
    const processableTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/tif']);

    return processableTypes.has(mimeType.toLowerCase());
}

/**
 * Validate image for OCR processing
 */
export async function validateImageForOcr(buffer: Buffer): Promise<{ valid: boolean; error?: string }> {
    // Check file size
    if (buffer.length > OCR_LIMITS.maxFileSize) {
        return {
            valid: false,
            error: `Image size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit of ${OCR_LIMITS.maxFileSize / 1024 / 1024}MB`,
        };
    }

    // Check if it's a valid image
    try {
        const metadata = await sharp(buffer).metadata();

        if (!metadata.width || !metadata.height) {
            return { valid: false, error: 'Invalid image: could not determine dimensions' };
        }

        // Check for zero-size images
        if (metadata.width === 0 || metadata.height === 0) {
            return { valid: false, error: 'Invalid image: zero dimensions' };
        }

        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error: `Invalid or corrupted image: ${error instanceof Error ? error.message : 'unknown error'}`,
        };
    }
}
