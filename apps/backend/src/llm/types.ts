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
    reason?: LlmSkipReason;
    processingType: LlmProcessingType;
    warnings?: string[];
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
    title?: string;
    key_entities: string[];
    topics: string[];
    document_type?: string;
    key_values?: Array<{ label: string; value: string }>;
    sentiment?: 'positive' | 'neutral' | 'negative';
    additional_dates?: string[];
}

export interface VisionResponse {
    description: string;
    detected_objects?: string[];
    scene_type?: 'outdoor' | 'indoor' | 'screenshot' | 'artwork' | 'other';
    has_people?: boolean;
}

// ===== Metadata Types =====

export interface EnhancedMetadata {
    type: 'text_summary' | 'vision_describe';
    title?: string;
    keyEntities: string[];
    topics: string[];
    sentiment?: 'positive' | 'neutral' | 'negative';
    documentType?: string;
    extractedDates?: string[];
    keyValues?: Array<{ label: string; value: string }>;
    // Sampling info (for large files)
    truncated?: boolean;
    samplingStrategy?: SamplingStrategy;
    originalTextLength?: number;
    sampledSections?: number;
    // Vision-specific
    detectedObjects?: string[];
    sceneType?: string;
    hasPeople?: boolean;
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
    skipped?: boolean;
    reason?: LlmSkipReason;
    summary?: string;
    enhancedMetadata?: EnhancedMetadata;
    tokenCount?: number;
    truncated?: boolean;
    samplingStrategy?: SamplingStrategy;
    originalTextLength?: number;
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
