/**
 * LLM Module
 *
 * LLM integration for document processing:
 * - Text summarization with smart sampling
 * - One call that sees an image together with its OCR text (screenshots and documents)
 * - Metadata enhancement
 */

// Main service
export { batchProcessDocuments, processDocument, reprocessDocument } from './llm.service';

// Eligibility checking
export { buildSkipMetadata, checkLlmEligibility, getFileCategory } from './eligibility';

// Text preparation
export { buildPromptWithSamplingContext, estimateTokenCount, prepareTextForLlm } from './text-preparer';

// LLM client (Anthropic)
export { isCapabilityAvailable, isVisionAvailable } from './provider-config';

// Types
export type {
    DocumentLlmResult,
    EnhancedMetadata,
    ExtractedDate,
    FileCategory,
    LlmEligibility,
    LlmMetadata,
    LlmProcessingType,
    LlmPrompt,
    LlmSkipReason,
    LlmSummaryResponse,
    PreparedText,
    SamplingStrategy,
    SkippedMetadata,
    TableRow,
} from './types';
