import type { DocumentCategory, ImageSize } from './types';

/**
 * Category Classifier
 *
 * Lightweight classifier for non-text images only (screenshot vs photo detection).
 * For documents with text, the LLM handles classification.
 */

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
 * Get a human-readable description of a category
 */
export function getCategoryDescription(category: DocumentCategory): string {
    const descriptions: Record<DocumentCategory, string> = {
        photo: 'Photo or personal image',
        screenshot: 'Screenshot or screen capture',
        graphic: 'Graphic, diagram, or illustration',
        receipt: 'Receipt or purchase record',
        invoice: 'Invoice or bill',
        statement: 'Account or bank statement',
        letter: 'Letter or correspondence',
        contract: 'Contract or legal agreement',
        form: 'Form or application',
        certificate: 'Certificate or license',
        report: 'Report or analysis',
        article: 'Article or publication',
        memo: 'Memo or internal note',
        newsletter: 'Newsletter or publication',
        stock_statement: 'Stock or investment statement',
        dividend_notice: 'Dividend notice',
        tax_document: 'Tax document or form',
        bank_statement: 'Bank statement',
        insurance_policy: 'Insurance policy',
        medical_record: 'Medical record',
        bill_of_materials: 'Bill of materials',
        securities_statement: 'Securities statement',
        other: 'Other document',
    };

    return descriptions[category] || 'Unknown document type';
}
