/**
 * OCR Pipeline Types (Plan 05)
 */

/**
 * Document categories - distinguishes between content types
 */
export type DocumentCategory =
    // Non-text content (photos, graphics)
    | 'photo' // Personal photos, images without text
    | 'screenshot' // Screen captures (may have some text but treated differently)
    | 'graphic' // Artwork, diagrams, illustrations

    // Common document types
    | 'receipt' // Purchase receipts, invoices
    | 'invoice' // Bills, invoices
    | 'statement' // Bank statements, account statements
    | 'letter' // Correspondence, emails
    | 'contract' // Legal agreements, contracts
    | 'form' // Filled forms, applications
    | 'certificate' // Certificates, licenses
    | 'report' // Reports, analyses
    | 'article' // News articles, blog posts
    | 'memo' // Internal memos, notes
    | 'newsletter' // Newsletters, publications

    // Financial documents (common use case)
    | 'stock_statement' // Stock/investment statements
    | 'dividend_notice' // Dividend notifications
    | 'tax_document' // Tax forms, returns
    | 'other'; // Uncategorized documents with text

/**
 * Extracted metadata from document text
 */
export interface ExtractedMetadata {
    dates: Date[];
    primaryDate?: Date | undefined; // Best guess for "document date"
    companies: string[];
    currencyValues: CurrencyValue[];
    percentages: number[];
}

export interface CurrencyValue {
    amount: number;
    currency: string;
}

/**
 * Image dimensions for processing
 */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * Text detection analysis result
 */
export interface TextDetectionResult {
    hasMeaningfulText: boolean;
    textDensity: number; // chars per 1000 pixels²
    confidenceScore: number;
    rawTextLength: number;
    reason?: 'low_density' | 'low_confidence' | 'short_text' | 'valid';
}

/**
 * Tesseract OCR output
 */
export interface TesseractOutput {
    text: string;
    confidence: number;
}

/**
 * Full OCR processing result
 */
export interface OcrProcessingResult {
    rawText: string;
    confidenceScore: number;
    textDensity: number;
    hasMeaningfulText: boolean;
    metadata: ExtractedMetadata | null;
    category: DocumentCategory;
    needsReview: boolean;
}

/**
 * Pre-processing options for images
 */
export interface PreprocessingOptions {
    maxWidth?: number | undefined;
    grayscale?: boolean | undefined;
    normalizeContrast?: boolean | undefined;
    removeNoise?: boolean | undefined;
}

/**
 * Thresholds for text detection
 */
export const TEXT_DETECTION_THRESHOLDS = {
    /** Minimum characters per 1000px² to consider meaningful */
    minTextDensity: 5,
    /** Minimum Tesseract confidence to consider reliable */
    minConfidence: 40,
    /** Minimum raw text length to consider meaningful */
    minTextLength: 20,
    /** Confidence below which to skip LLM processing */
    llmSkipThreshold: 30,
    /** Confidence below which to flag for review */
    reviewThreshold: 60,
} as const;

/**
 * Resource limits for OCR processing
 */
export const OCR_LIMITS = {
    /** Maximum image size in bytes (10MB) */
    maxFileSize: 10 * 1024 * 1024,
    /** Maximum image width before resizing */
    maxImageWidth: 2000,
    /** Maximum processing time per image in ms */
    maxProcessingTime: 30000,
} as const;
