/**
 * LLM Module
 *
 * LLM integration for document processing:
 * - Text summarization with smart sampling
 * - Vision processing for images
 * - Metadata enhancement
 */

// Main service
export { batchProcessDocuments, processDocument, reprocessDocument } from './llm.service';

// Eligibility checking
export { buildSkipMetadata, checkLlmEligibility, getFileCategory } from './eligibility';

// Text preparation
export { buildPromptWithSamplingContext, estimateTokenCount, prepareTextForLlm } from './text-preparer';

// OpenAI client
export { isOpenAIAvailable, isVisionAvailable } from './openai.client';

// Types
export type {
    DocumentLlmResult,
    EnhancedMetadata,
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
    VisionResponse,
    VisionResult,
} from './types';
