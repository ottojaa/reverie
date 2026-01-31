import type { DocumentCategory, ExtractedMetadata, ImageSize } from './types';
import { CATEGORY_KEYWORDS } from './patterns';

/**
 * Category Classifier (Plan 05)
 *
 * Classifies documents based on:
 * 1. Whether text was detected
 * 2. Keyword matching for documents with text
 * 3. Image characteristics for non-text content
 */

interface CategoryScore {
    category: DocumentCategory;
    score: number;
}

/**
 * Common screenshot aspect ratios
 */
const SCREENSHOT_ASPECT_RATIOS = [
    { ratio: 16 / 9, name: '16:9' }, // Modern widescreen
    { ratio: 16 / 10, name: '16:10' }, // MacBook, etc.
    { ratio: 4 / 3, name: '4:3' }, // Traditional
    { ratio: 21 / 9, name: '21:9' }, // Ultrawide
    { ratio: 9 / 16, name: '9:16' }, // Mobile portrait
    { ratio: 3 / 4, name: '3:4' }, // Tablet portrait
];

/**
 * Classify a document based on its text content
 */
export function classifyDocument(text: string, metadata: ExtractedMetadata, hasMeaningfulText: boolean): DocumentCategory {
    // If no meaningful text, defer to non-text classification
    if (!hasMeaningfulText) {
        return 'other'; // Will be overridden by classifyNonTextImage
    }

    const normalizedText = text.toLowerCase();
    const scores: CategoryScore[] = [];

    // Score each category based on keyword matches
    for (const [category, { keywords, weight }] of Object.entries(CATEGORY_KEYWORDS)) {
        let score = 0;

        for (const keyword of keywords) {
            // Count occurrences of each keyword
            const regex = new RegExp(keyword.toLowerCase(), 'gi');
            const matches = normalizedText.match(regex);
            if (matches) {
                score += matches.length * weight;
            }
        }

        if (score > 0) {
            scores.push({
                category: category as DocumentCategory,
                score,
            });
        }
    }

    // Boost scores based on extracted metadata
    if (metadata.currencyValues.length > 0) {
        // Documents with currency are likely financial
        boostScore(scores, 'receipt', 1);
        boostScore(scores, 'invoice', 1);
        boostScore(scores, 'statement', 1);
        boostScore(scores, 'stock_statement', 1);
    }

    if (metadata.percentages.length > 0) {
        // Percentages often indicate financial/report documents
        boostScore(scores, 'report', 1);
        boostScore(scores, 'stock_statement', 1);
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    // Return highest scoring category, or 'other' if no strong matches
    const topScore = scores[0];
    if (topScore && topScore.score >= 2) {
        return topScore.category;
    }

    return 'other';
}

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
    const commonScreenWidths = [1920, 1280, 2560, 3840, 1440, 1366, 750, 1125, 1242]; // Desktop + mobile
    const isCommonScreenWidth = commonScreenWidths.some((w) => Math.abs(width - w) < 50);

    if ((isScreenshotRatio && width >= 1024) || (isCommonScreenWidth && width >= 640)) {
        return 'screenshot';
    }

    // Default to photo for images without text
    return 'photo';
}

/**
 * Helper to boost a category's score
 */
function boostScore(scores: CategoryScore[], category: DocumentCategory, boost: number): void {
    const existing = scores.find((s) => s.category === category);
    if (existing) {
        existing.score += boost;
    } else {
        scores.push({ category, score: boost });
    }
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
        other: 'Other document',
    };

    return descriptions[category] || 'Unknown document type';
}
