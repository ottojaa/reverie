import { NON_TEXT_CATEGORIES } from '@reverie/shared';
import type { DocumentCategory, ImageSize } from './types';

/**
 * Category Classifier
 *
 * Lightweight classifier for non-text images only (screenshot vs photo detection).
 * For documents with text, the LLM handles classification.
 */

/**
 * Screenshot filename markers. Anchored so it matches "Screenshot", "Screen Shot"
 * (macOS), "Screenshot_20260102-…" (Android), "screencapture", "screen grab", and
 * "screen recording" without false-matching words like "sunscreen" or "screencast".
 */
const SCREENSHOT_FILENAME_RE = /screen[\s._-]?shot|screen[\s._-]?(?:capture|grab|recording)/i;

/**
 * Exact device screen resolutions (stored as min×max; matched in either orientation).
 * Screenshots are pixel-exact to a device resolution and effectively always PNG — this
 * catches captures whose filenames give nothing away (e.g. iOS "IMG_1234.PNG").
 */
const SCREEN_RESOLUTION_PAIRS: ReadonlyArray<readonly [number, number]> = [
    // iPhone
    [1170, 2532],
    [1179, 2556],
    [1284, 2778],
    [1290, 2796],
    [1206, 2622],
    [1320, 2868],
    [1125, 2436],
    [1242, 2688],
    [828, 1792],
    [750, 1334],
    [640, 1136],
    // iPad
    [1620, 2160],
    [1640, 2360],
    [1668, 2388],
    [1668, 2224],
    [1488, 2266],
    [2048, 2732],
    // Android
    [1080, 1920],
    [1080, 2340],
    [1080, 2400],
    [1080, 2280],
    [1440, 2560],
    [1440, 3040],
    [1440, 3200],
    [720, 1280],
    // Desktop / laptop
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
    [1366, 768],
    [1280, 800],
    [1440, 900],
    [1680, 1050],
    [2560, 1600],
    [2880, 1800],
    [1512, 982],
    [1728, 1117],
    [3024, 1964],
    [3456, 2234],
];

const SCREEN_RESOLUTIONS = new Set(SCREEN_RESOLUTION_PAIRS.map(([a, b]) => `${Math.min(a, b)}x${Math.max(a, b)}`));

function matchesExactScreenResolution(width: number, height: number): boolean {
    return SCREEN_RESOLUTIONS.has(`${Math.min(width, height)}x${Math.max(width, height)}`);
}

export interface ScreenshotDetectionInput {
    filename: string;
    mimeType: string;
    imageSize: ImageSize;
}

/**
 * High-precision screenshot detector. Runs for every image regardless of OCR text —
 * real screenshots are full of UI text, so they can't rely on `classifyNonTextImage`.
 * Both signals that could touch a real photo require PNG, so JPEG/HEIC photos and
 * print-resolution scans (e.g. A4 @ 300dpi) are never mislabeled.
 */
export function detectScreenshot({ filename, mimeType, imageSize }: ScreenshotDetectionInput): boolean {
    if (SCREENSHOT_FILENAME_RE.test(filename)) return true;

    const isPng = mimeType.toLowerCase() === 'image/png';

    return isPng && matchesExactScreenResolution(imageSize.width, imageSize.height);
}

/** Whether a category is a visual (non-text) one the LLM text path must not overwrite. */
export function isVisualCategory(category: string | null): boolean {
    return category != null && (NON_TEXT_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Common screenshot aspect ratios
 */
const SCREENSHOT_ASPECT_RATIOS = [
    { ratio: 16 / 9 }, // Modern widescreen
    { ratio: 16 / 10 }, // MacBook, etc.
    { ratio: 4 / 3 }, // Traditional
    { ratio: 21 / 9 }, // Ultrawide
    { ratio: 9 / 16 }, // Mobile portrait
    { ratio: 3 / 4 }, // Tablet portrait
];

/**
 * Classify an image without meaningful text
 */
export function classifyNonTextImage(imageSize: ImageSize, filename: string): DocumentCategory {
    const { width, height } = imageSize;
    const aspectRatio = width / height;

    // Check filename hints first
    const lowerFilename = filename.toLowerCase();

    if (lowerFilename.includes('screenshot') || lowerFilename.includes('screen') || lowerFilename.includes('capture')) {
        return 'screenshot';
    }

    if (lowerFilename.includes('diagram') || lowerFilename.includes('chart') || lowerFilename.includes('graph') || lowerFilename.includes('illustration')) {
        return 'graphic';
    }

    // Check aspect ratio for screenshot detection
    const isScreenshotRatio = SCREENSHOT_ASPECT_RATIOS.some((ar) => Math.abs(aspectRatio - ar.ratio) < 0.1);

    // Screenshots tend to have specific dimensions (screen resolutions)
    const commonScreenWidths = [1920, 1280, 2560, 3840, 1440, 1366, 750, 1125, 1242];
    const isCommonScreenWidth = commonScreenWidths.some((w) => Math.abs(width - w) < 50);

    if ((isScreenshotRatio && width >= 1024) || (isCommonScreenWidth && width >= 640)) {
        return 'screenshot';
    }

    return 'photo';
}

/**
 * Get a human-readable description of a category.
 * Accepts any string (DB may have values not in DocumentCategory).
 */
export function getCategoryDescription(category: string): string {
    const descriptions: Record<string, string> = {
        photo: 'Photo or personal image',
        screenshot: 'Screenshot or screen capture',
        graphic: 'Graphic, diagram, or illustration',
        video: 'Video',
        receipt: 'Receipt or purchase record',
        invoice: 'Invoice or bill',
        letter: 'Letter or correspondence',
        contract: 'Contract or legal agreement',
        form: 'Form or application',
        certificate: 'Certificate or license',
        report: 'Report or analysis',
        article: 'Article or publication',
        memo: 'Memo or internal note',
        newsletter: 'Newsletter or publication',
        stock_statement: 'Stock or investment statement',
        bank_statement: 'Bank statement',
        medical_record: 'Medical record',
        bill_of_materials: 'Bill of materials',
        other: 'Other document',
    };

    return descriptions[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
