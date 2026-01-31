/**
 * LLM Module Types
 */

// ===== Processing Types =====

export type LlmProcessingType = 'text_summary' | 'vision_describe' | 'skip';

export type LlmSkipReason =
    | 'llm_disabled' // LLM feature flag is off
    | 'unsupported_file_type' // Binary, media, etc.
    | 'code_file_skipped' // Code files not processed
    | 'no_text_no_vision' // Image without text, vision disabled
    | 'no_text_content' // Empty or no extractable text
    | 'ocr_confidence_too_low' // OCR quality too poor
    | 'user_opted_out' // User disabled for this document
    | 'vision_disabled'; // Vision feature is disabled

export type SamplingStrategy = 'full' | 'start_end' | 'distributed';

// ===== Eligibility =====

export interface LlmEligibility {
    eligible: boolean;
    reason?: LlmSkipReason | undefined;
    processingType: LlmProcessingType;
    warnings?: string[] | undefined;
}

// ===== Text Preparation =====

export interface PreparedText {
    text: string;
    truncated: boolean;
    samplingStrategy: SamplingStrategy;
    originalLength: number;
    sampledSections: number;
}

// ===== Prompt =====

export interface LlmPrompt {
    system: string;
    user: string;
    maxTokens: number;
}

// ===== LLM Response Types =====

export interface LlmSummaryResponse {
    summary: string;
    title?: string | undefined;
    key_entities: string[];
    topics: string[];
    document_type?: string | undefined;
    key_values?: Array<{ label: string; value: string }> | undefined;
    sentiment?: 'positive' | 'neutral' | 'negative' | undefined;
    additional_dates?: string[] | undefined;
}

export interface VisionResponse {
    description: string;
    detected_objects?: string[] | undefined;
    scene_type?: 'outdoor' | 'indoor' | 'screenshot' | 'artwork' | 'other' | undefined;
    has_people?: boolean | undefined;
}

// ===== Metadata Types =====

export interface EnhancedMetadata {
    type: 'text_summary' | 'vision_describe';
    title?: string | undefined;
    keyEntities: string[];
    topics: string[];
    sentiment?: 'positive' | 'neutral' | 'negative' | undefined;
    documentType?: string | undefined;
    extractedDates?: string[] | undefined;
    keyValues?: Array<{ label: string; value: string }> | undefined;
    // Sampling info (for large files)
    truncated?: boolean | undefined;
    samplingStrategy?: SamplingStrategy | undefined;
    originalTextLength?: number | undefined;
    sampledSections?: number | undefined;
    // Vision-specific
    detectedObjects?: string[] | undefined;
    sceneType?: string | undefined;
    hasPeople?: boolean | undefined;
    // Index signature for kysely compatibility
    [key: string]: unknown;
}

export interface SkippedMetadata {
    skipped: true;
    skipReason: LlmSkipReason;
    skippedAt: string;
    originalTextLength?: number;
    warnings?: string[];
}

export type LlmMetadata = EnhancedMetadata | SkippedMetadata;

// ===== Service Types =====

export interface DocumentLlmResult {
    success: boolean;
    skipped?: boolean | undefined;
    reason?: LlmSkipReason | undefined;
    summary?: string | undefined;
    enhancedMetadata?: EnhancedMetadata | undefined;
    tokenCount?: number | undefined;
    truncated?: boolean | undefined;
    samplingStrategy?: SamplingStrategy | undefined;
    originalTextLength?: number | undefined;
}

export interface VisionResult {
    success: boolean;
    skipped?: boolean;
    reason?: LlmSkipReason;
    description?: string;
    metadata?: EnhancedMetadata;
    tokenCount?: number;
}

// ===== File Categories =====

export type FileCategory = 'image' | 'document' | 'text' | 'code' | 'media' | 'binary';
