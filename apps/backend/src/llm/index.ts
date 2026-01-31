/**
 * LLM Module (Plan 06)
 *
 * LLM integration for document processing:
 * - Text summarization with smart sampling
 * - Vision processing for images
 * - Metadata enhancement
 */

// Main service
export { processDocument, reprocessDocument, batchProcessDocuments } from './llm.service';

// Eligibility checking
export { checkLlmEligibility, getFileCategory, buildSkipMetadata } from './eligibility';

// Text preparation
export { prepareTextForLlm, buildPromptWithSamplingContext, estimateTokenCount } from './text-preparer';

// OpenAI client
export { isOpenAIAvailable, isVisionAvailable } from './openai.client';

// Types
export type {
    LlmProcessingType,
    LlmSkipReason,
    SamplingStrategy,
    LlmEligibility,
    PreparedText,
    LlmPrompt,
    LlmSummaryResponse,
    VisionResponse,
    EnhancedMetadata,
    SkippedMetadata,
    LlmMetadata,
    DocumentLlmResult,
    VisionResult,
    FileCategory,
} from './types';
