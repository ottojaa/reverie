/**
 * Image transform pipeline for the image editor.
 * Applies crop, rotation, and flip to produce a final image blob.
 */

import { centerCrop, makeAspectCrop, type Crop } from 'react-image-crop';

export interface CropArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Convert percent crop to pixel crop in natural image dimensions.
 * ReactCrop's pixel crop is in displayed coords; percent is resolution-independent.
 */
export function percentCropToPixelCrop(
    percentCrop: { x: number; y: number; width: number; height: number },
    naturalWidth: number,
    naturalHeight: number,
): CropArea {
    return {
        x: Math.round((percentCrop.x / 100) * naturalWidth),
        y: Math.round((percentCrop.y / 100) * naturalHeight),
        width: Math.round((percentCrop.width / 100) * naturalWidth),
        height: Math.round((percentCrop.height / 100) * naturalHeight),
    };
}

export interface TransformState {
    crop: CropArea;
    rotation: number; // 0, 90, 180, 270
    flipH: boolean;
    flipV: boolean;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.addEventListener('load', () => resolve(img));
        img.addEventListener('error', (e) => reject(e));
        img.src = src;
    });
}

/** Pixel size of the image after rotation (before flip), used for crop math. */
export function computeRotatedDimensions(
    naturalWidth: number,
    naturalHeight: number,
    rotation: number,
): { width: number; height: number } {
    const swapDims = rotation === 90 || rotation === 270;

    return {
        width: swapDims ? naturalHeight : naturalWidth,
        height: swapDims ? naturalWidth : naturalHeight,
    };
}

/** Preview is downscaled so rotate/flip stays responsive on mobile (full-res canvas + JPEG encode is very slow). */
export const IMAGE_EDITOR_PREVIEW_MAX_DIMENSION = 2048;

/**
 * Create a File from a Blob with the given filename.
 */
export function blobToFile(blob: Blob, filename: string, mimeType: string): File {
    return new File([blob], filename, { type: mimeType });
}

export function getBasename(filename: string): string {
    const lastDot = filename.lastIndexOf('.');

    return lastDot >= 0 ? filename.slice(0, lastDot) : filename;
}

export function getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');

    return lastDot >= 0 ? filename.slice(lastDot) : '';
}

/**
 * Get file extension and MIME type from original filename.
 */
export function getOutputFormat(originalFilename: string): { ext: string; mimeType: string } {
    const ext = originalFilename.split('.').pop()?.toLowerCase() ?? 'jpg';

    const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
    };

    return {
        ext,
        mimeType: mimeMap[ext] ?? 'image/jpeg',
    };
}

/**
 * Render the image with rotation and flip applied (no crop). Returns an object URL.
 * Used to display the transformed image in the cropper so the crop area matches the visible orientation.
 * Caps output size for preview so rotate/flip does not run full-resolution encode on every tap (slow on mobile).
 */
export async function renderTransformedImage(
    imageSrc: string,
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    mimeType: string = 'image/jpeg',
    quality: number = 0.85,
    maxOutputDimension: number = IMAGE_EDITOR_PREVIEW_MAX_DIMENSION,
): Promise<string> {
    const img = await loadImage(imageSrc);
    const { width: fullW, height: fullH } = computeRotatedDimensions(img.naturalWidth, img.naturalHeight, rotation);

    const scale = Math.min(1, maxOutputDimension / Math.max(fullW, fullH, 1));
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Could not get canvas context');

    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.scale(scale, scale);
    ctx.translate(-img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.drawImage(img, 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(URL.createObjectURL(blob));
                } else {
                    reject(new Error('Failed to create blob'));
                }
            },
            mimeType,
            quality,
        );
    });
}

/**
 * Apply crop, rotation, and flip to an image and return as Blob.
 * cropArea is in the coordinate system of the image AFTER rotation and flip (i.e. what the user sees in the cropper).
 */
export async function applyTransforms(
    imageSrc: string,
    cropArea: CropArea,
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    mimeType: string = 'image/jpeg',
    quality: number = 0.92,
): Promise<Blob> {
    const img = await loadImage(imageSrc);
    const { width: cropW, height: cropH, x: cropX, y: cropY } = cropArea;

    // Step 1: Create rotated+flipped full image (what user sees)
    const swapDims = rotation === 90 || rotation === 270;
    const rotatedW = swapDims ? img.naturalHeight : img.naturalWidth;
    const rotatedH = swapDims ? img.naturalWidth : img.naturalHeight;

    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = rotatedW;
    rotatedCanvas.height = rotatedH;
    const rotCtx = rotatedCanvas.getContext('2d');

    if (!rotCtx) {
        throw new Error('Could not get canvas context');
    }

    const rcx = rotatedW / 2;
    const rcy = rotatedH / 2;

    rotCtx.translate(rcx, rcy);
    rotCtx.rotate((rotation * Math.PI) / 180);
    rotCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    rotCtx.translate(-img.naturalWidth / 2, -img.naturalHeight / 2);
    rotCtx.drawImage(img, 0, 0);

    // Step 2: Crop from the rotated+flipped image
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Could not get canvas context');
    }

    ctx.drawImage(rotatedCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create blob from canvas'));
                }
            },
            mimeType,
            quality,
        );
    });
}

/**
 * Full-image crop. Free-form uses percent; aspect-locked uses percent (per react-image-crop recommendation).
 * For aspect: use the smaller dimension so makeAspectCrop fits within bounds on both portrait and landscape.
 */
export function createFullCrop(width: number, height: number, aspect?: number): Crop {
    if (aspect === undefined) return { unit: '%', x: 0, y: 0, width: 100, height: 100 };

    const isPortrait = height > width;
    const initialCrop = isPortrait ? { unit: '%' as const, height: 100 } : { unit: '%' as const, width: 100 };
    const percentCrop = centerCrop(makeAspectCrop(initialCrop, aspect, width, height), width, height);

    return percentCrop;
}

/**
 * Generate filename for save-as-copy: "basename (Copy).ext"
 */
export function getCopyFilename(originalFilename: string): string {
    const lastDot = originalFilename.lastIndexOf('.');
    const base = lastDot >= 0 ? originalFilename.slice(0, lastDot) : originalFilename;
    const ext = lastDot >= 0 ? originalFilename.slice(lastDot) : '';

    return `${base} (Copy)${ext}`;
}
