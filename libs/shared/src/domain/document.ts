// Domain types for documents (not tied to API schemas)

import type { DocumentKind, Entity } from '../api/schemas/documents.js';

export interface OcrResult {
    raw_text: string;
    confidence_score: number;
    metadata: ExtractedMetadata;
}

export interface ExtractedMetadata {
    dates: string[];
    primary_date?: string;
    companies: string[];
    currency_values: CurrencyValue[];
    stock_quantities: number[];
    percentages: number[];
}

export interface CurrencyValue {
    amount: number;
    currency: string;
}

/**
 * Structured key entities extracted by the LLM.
 * Matches the backend EnhancedMetadata.keyEntities shape.
 */
export interface KeyEntities {
    people: string[];
    organizations: string[];
    locations: string[];
}

/**
 * Row of tabular data extracted from the document.
 */
export interface TableRow {
    item: string;
    columns: Record<string, string>;
}

export interface KeyValue {
    label: string;
    value: string;
}

/**
 * A date extracted from the document, with context about what it represents.
 */
export interface ExtractedDate {
    date: string;
    context: string;
}

/**
 * LLM-generated metadata stored in the `llm_metadata` column.
 * Matches the backend `EnhancedMetadata` shape (camelCase).
 *
 * NOTE: The API schema types this as `Record<string, unknown> | null`,
 * so consumers must parse/validate at runtime.
 */
export interface LlmMetadata {
    /** `vision_describe` only appears on rows written before the image call replaced it. */
    type: 'text_summary' | 'image_understanding' | 'vision_describe';
    title?: string;
    /** What app or source an image comes from (e.g. "Lunamux terminal"); only the image call sets it. */
    appOrSource?: string;
    /** The kind the image call settled on: screenshot, document, receipt or diagram. */
    imageKind?: string;
    language?: string;
    entities: Entity[];
    topics: string[];
    documentType?: string;
    extractedDate?: string;
    extractedDates?: ExtractedDate[];
    keyValues?: KeyValue[];
    tableData?: TableRow[];
}

/**
 * The kind a MIME type belongs to: `image/*` is an image, `video/*` a video, everything else (an empty or unknown
 * type too) a file. Case-insensitive, by prefix only, so `image/svg+xml` and `image/heic` are images.
 * The backend's SQL filter and the Android client's DocumentKind.of follow this rule.
 */
export function documentKindOf(mimeType: string): DocumentKind {
    const mime = mimeType.toLowerCase();

    if (mime.startsWith('image/')) return 'image';

    if (mime.startsWith('video/')) return 'video';

    return 'file';
}
