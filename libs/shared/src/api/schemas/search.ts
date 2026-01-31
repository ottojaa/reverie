import { z } from 'zod';
import { UuidSchema, DateOnlySchema, PaginationQuerySchema } from './common.js';
import { DocumentCategoryEnum } from './documents.js';

// ============================================================================
// Parsed Query Types (internal representation of search query)
// ============================================================================

export const DateRangeSchema = z.object({
    start: z.date().optional(),
    end: z.date().optional(),
    relative: z.enum(['today', 'yesterday', 'last-week', 'last-month', 'last-year']).optional(),
});

export type DateRange = z.infer<typeof DateRangeSchema>;

// Base schema without negations (to avoid circular reference)
const ParsedQueryBaseSchema = z.object({
    // Text search
    fullText: z.string().optional(),
    searchScope: z.enum(['all', 'filename', 'content', 'summary']).optional(),

    // File type filters
    types: z.array(z.string()).optional(), // photo, document, receipt, screenshot
    formats: z.array(z.string()).optional(), // pdf, jpg, png

    // Date filters
    uploadedRange: DateRangeSchema.optional(),
    extractedDateRange: DateRangeSchema.optional(),

    // Location filters
    folders: z.array(z.string()).optional(),
    folderIds: z.array(UuidSchema).optional(),

    // Property filters
    hasText: z.boolean().optional(),
    hasSummary: z.boolean().optional(),
    hasThumbnail: z.boolean().optional(),

    // Size filter (in bytes)
    sizeMin: z.number().optional(),
    sizeMax: z.number().optional(),

    // Metadata filters
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
});

// Full schema with negations
export const ParsedQuerySchema = ParsedQueryBaseSchema.extend({
    negations: ParsedQueryBaseSchema.partial().optional(),
});

export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

// ============================================================================
// Search Query API (what the client sends)
// ============================================================================

export const SortByEnum = z.enum(['relevance', 'uploaded', 'date', 'filename', 'size']);
export type SortBy = z.infer<typeof SortByEnum>;

export const SearchQuerySchema = PaginationQuerySchema.extend({
    q: z.string().min(0).default(''), // Allow empty for browsing
    category: DocumentCategoryEnum.optional(),
    date_from: DateOnlySchema.optional(),
    date_to: DateOnlySchema.optional(),
    folder_id: UuidSchema.optional(),
    sort_by: SortByEnum.default('relevance'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
    include_facets: z.coerce.boolean().default(true),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ============================================================================
// Search Results
// ============================================================================

export const SearchResultSchema = z.object({
    document_id: UuidSchema,
    filename: z.string(),
    folder_path: z.string().nullable(),
    folder_id: UuidSchema.nullable(),

    // Dates
    uploaded_at: z.string().datetime(),
    extracted_date: DateOnlySchema.nullable(),

    // Classification
    category: DocumentCategoryEnum.nullable(),
    mime_type: z.string(),
    format: z.string(), // File extension

    // Content
    snippet: z.string().nullable(), // Highlighted excerpt (if text search)
    has_text: z.boolean(),

    // Visual
    thumbnail_url: z.string().nullable(),
    blurhash: z.string().nullable(),

    // Metadata
    size_bytes: z.number(),
    tags: z.array(z.string()),

    // Relevance (for text searches)
    relevance: z.number().nullable(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

// ============================================================================
// Facets
// ============================================================================

export const FacetItemSchema = z.object({
    name: z.string(),
    count: z.number(),
    selected: z.boolean().optional(),
});

export type FacetItem = z.infer<typeof FacetItemSchema>;

export const SearchFacetsSchema = z.object({
    // Primary facets (always shown)
    types: z.array(FacetItemSchema), // photo, document, receipt, screenshot
    formats: z.array(FacetItemSchema), // pdf, jpg, png, etc.
    folders: z.array(FacetItemSchema), // Top folders with counts
    uploadPeriod: z.array(FacetItemSchema), // This week, this month, older

    // Secondary facets
    tags: z.array(FacetItemSchema),
    hasText: z.array(FacetItemSchema), // With text / Without text

    // Entity facets (if entities extracted)
    categories: z.array(FacetItemSchema),
    entities: z.array(FacetItemSchema).optional(), // Companies, people, etc.
});

export type SearchFacets = z.infer<typeof SearchFacetsSchema>;

// ============================================================================
// Search Response
// ============================================================================

export const SearchResponseSchema = z.object({
    total: z.number(),
    results: z.array(SearchResultSchema),
    facets: SearchFacetsSchema.optional(),
    query: ParsedQuerySchema.optional(), // Parsed query for debugging
    timing_ms: z.number(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ============================================================================
// Suggestions / Autocomplete
// ============================================================================

export const SuggestionTypeEnum = z.enum(['filename', 'folder', 'tag', 'entity', 'category']);
export type SuggestionType = z.infer<typeof SuggestionTypeEnum>;

export const SuggestQuerySchema = z.object({
    type: SuggestionTypeEnum,
    q: z.string().min(1),
    limit: z.coerce.number().min(1).max(20).default(10),
});

export type SuggestQuery = z.infer<typeof SuggestQuerySchema>;

export const SuggestResponseSchema = z.array(z.string());
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

// ============================================================================
// Recent Searches
// ============================================================================

export const RecentSearchSchema = z.object({
    query: z.string(),
    timestamp: z.string().datetime(),
    resultCount: z.number(),
});

export type RecentSearch = z.infer<typeof RecentSearchSchema>;

export const RecentSearchesResponseSchema = z.array(RecentSearchSchema);
export type RecentSearchesResponse = z.infer<typeof RecentSearchesResponseSchema>;

// ============================================================================
// Facets-only endpoint
// ============================================================================

export const FacetsQuerySchema = z.object({
    q: z.string().min(0).default(''),
});

export type FacetsQuery = z.infer<typeof FacetsQuerySchema>;

export const FacetsResponseSchema = z.object({
    facets: SearchFacetsSchema,
});

export type FacetsResponse = z.infer<typeof FacetsResponseSchema>;
