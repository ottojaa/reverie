import sharp from 'sharp';
import type { ImageSize, PreprocessingOptions } from './types';
import { OCR_LIMITS } from './types';

/**
 * Image Preprocessor for OCR
 *
 * Optimizes images before OCR processing:
 * - Upscale small images (OCR engines perform better on higher-res images)
 * - Convert to grayscale (improves accuracy)
 * - Normalize contrast
 * - Sharpen edges for clearer text
 * - Optional noise removal
 */

const DEFAULT_OPTIONS: PreprocessingOptions = {
    targetMinWidth: OCR_LIMITS.targetMinWidth,
    targetMaxDimension: OCR_LIMITS.targetMaxDimension,
    grayscale: true,
    normalizeContrast: true,
    sharpen: true,
    removeNoise: false, // Disabled by default as it can sometimes hurt quality
};

type SharpImageMetadata = { width?: number; height?: number };

export async function getImageMetadata(buffer: Buffer): Promise<SharpImageMetadata> {
    return sharp(buffer).metadata();
}

/**
 * Preprocess an image buffer for optimal OCR results
 */
export async function preprocessImage(buffer: Buffer, options: PreprocessingOptions = {}, metadata?: SharpImageMetadata): Promise<Buffer> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    let pipeline = sharp(buffer);

    // Get current dimensions to decide on scaling
    const resolvedMetadata = metadata ?? (await getImageMetadata(buffer));
    const currentWidth = resolvedMetadata.width ?? 0;
    const currentHeight = resolvedMetadata.height ?? 0;
    const longestSide = Math.max(currentWidth, currentHeight);

    // Downscale oversized images first — keeps OCR fast without losing meaningful detail
    if (opts.targetMaxDimension && longestSide > opts.targetMaxDimension) {
        pipeline = pipeline.resize({
            width: currentWidth >= currentHeight ? opts.targetMaxDimension : undefined,
            height: currentHeight > currentWidth ? opts.targetMaxDimension : undefined,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: 'lanczos3',
        });
    } else if (opts.targetMinWidth && currentWidth > 0 && currentWidth < opts.targetMinWidth) {
        // Upscale small images for better OCR accuracy
        pipeline = pipeline.resize({
            width: opts.targetMinWidth,
            fit: 'inside',
            withoutEnlargement: false, // Allow upscaling
            kernel: 'lanczos3',
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

    // Sharpen edges for clearer text recognition
    if (opts.sharpen) {
        pipeline = pipeline.sharpen({ sigma: 1.5 });
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
export async function getImageSize(buffer: Buffer, metadata?: SharpImageMetadata): Promise<ImageSize> {
    const resolvedMetadata = metadata ?? (await getImageMetadata(buffer));

    return {
        width: resolvedMetadata.width ?? 0,
        height: resolvedMetadata.height ?? 0,
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
export async function validateImageForOcr(buffer: Buffer, metadata?: SharpImageMetadata): Promise<{ valid: boolean; error?: string }> {
    if (buffer.length > OCR_LIMITS.maxFileSize) {
        return {
            valid: false,
            error: `Image size ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit of ${OCR_LIMITS.maxFileSize / 1024 / 1024}MB`,
        };
    }

    try {
        const resolvedMetadata = metadata ?? (await getImageMetadata(buffer));

        if (!resolvedMetadata.width || !resolvedMetadata.height) {
            return { valid: false, error: 'Invalid image: could not determine dimensions' };
        }

        if (resolvedMetadata.width === 0 || resolvedMetadata.height === 0) {
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
