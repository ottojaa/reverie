// Domain types for documents (not tied to API schemas)

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
    type: 'text_summary' | 'vision_describe';
    title?: string;
    language?: string;
    keyEntities: KeyEntities;
    topics: string[];
    sentiment?: 'positive' | 'neutral' | 'negative';
    documentType?: string;
    extractedDate?: string;
    extractedDates?: ExtractedDate[];
    keyValues?: KeyValue[];
    tableData?: TableRow[];
}
