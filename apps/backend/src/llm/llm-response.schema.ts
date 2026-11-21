/**
 * LLM Response Schema
 *
 * The structured-output contract for per-document analysis. This is a *model*
 * contract (enforced via output_config.format), not a web-facing API contract,
 * so it lives in the backend rather than in @reverie/shared.
 *
 * Rules honored for structured outputs:
 * - Scalars are required + `.nullable()` (not `.optional()`) so the model always
 *   emits the key with an explicit null when absent.
 * - No min/max/length constraints in the wire schema — the SDK would strip them
 *   and then validate client-side, turning e.g. an over-long tag into a hard
 *   parse failure. Tag/entity limits are enforced deterministically downstream
 *   (see tag-sanitizer.ts and entity-grounding.ts).
 */

// zod/v4 subpath (bundled in zod 3.25+): matches the schema type that
// @anthropic-ai/sdk/helpers/zod's `zodOutputFormat` expects. Only inferred types
// leave this file, so the choice of entry point is local to structured output.
import * as z from 'zod/v4';

// Aligned with the text-document subset of @reverie/shared DocumentCategoryEnum,
// so the value can be written straight into documents.document_category.
export const LlmDocumentTypeSchema = z.enum([
    'receipt',
    'invoice',
    'letter',
    'contract',
    'form',
    'certificate',
    'report',
    'article',
    'memo',
    'newsletter',
    'stock_statement',
    'bank_statement',
    'medical_record',
    'bill_of_materials',
    'other',
]);

export const LlmEntitySchema = z.object({
    type: z.enum(['person', 'organization', 'location', 'product', 'account', 'identifier', 'contact', 'other']),
    canonical_name: z.string(),
    raw_text: z.string(),
});

export const LlmAnalysisSchema = z.object({
    summary: z.string(),
    title: z.string().nullable(),
    document_type: LlmDocumentTypeSchema.nullable(),
    language: z.string().nullable(), // ISO 639-1
    entities: z.array(LlmEntitySchema),
    topics: z.array(z.string()),
    tags: z.array(z.string()),
    extracted_date: z.string().nullable(), // YYYY-MM-DD
});

export type LlmAnalysis = z.infer<typeof LlmAnalysisSchema>;
export type LlmEntity = z.infer<typeof LlmEntitySchema>;
export type LlmDocumentType = z.infer<typeof LlmDocumentTypeSchema>;

/**
 * What the one image call returns. `kind` has no `photo`: a photo is never sent, and the model cannot move an image
 * to photo. It may move among the other kinds, e.g. a "document" that is really a screenshot of a page.
 */
export const LlmImageUnderstandingSchema = z.object({
    kind: z.enum(['screenshot', 'document', 'receipt', 'diagram']),
    // The app, site or source the picture shows ("Lunamux terminal", "Gmail", "Nordea statement"); null when there is none.
    app_or_source: z.string().nullable(),
    title: z.string().nullable(),
    summary: z.string(),
    document_type: LlmDocumentTypeSchema.nullable(),
    language: z.string().nullable(), // ISO 639-1
    entities: z.array(LlmEntitySchema),
    topics: z.array(z.string()),
    tags: z.array(z.string()),
    extracted_date: z.string().nullable(), // YYYY-MM-DD
});

export type LlmImageUnderstanding = z.infer<typeof LlmImageUnderstandingSchema>;
