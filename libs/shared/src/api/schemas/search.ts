import { z } from 'zod';
import { UuidSchema, DateOnlySchema, PaginationQuerySchema } from './common.js';
import { DocumentCategoryEnum, ThumbnailUrlsSchema } from './documents.js';
import { FolderTypeSchema } from './folders.js';

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

    // Location filters (matches city or country)
    locations: z.array(z.string()).optional(),
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

// All filtering is expressed inside the `q` DSL (see libs/shared/src/search/query-tokens.ts)
export const SearchQuerySchema = PaginationQuerySchema.extend({
    q: z.string().min(0).default(''), // Allow empty for browsing
    sort_by: SortByEnum.default('relevance'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
    // Not z.coerce.boolean(): that turns the query-string "false" into true
    include_facets: z.union([z.boolean(), z.string().transform((v) => v !== 'false' && v !== '0')]).default(true),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ============================================================================
// Search Results
// ============================================================================

// A single document hit. `result_type` is the discriminator for the unified SearchHit.
export const DocumentSearchResultSchema = z.object({
    result_type: z.literal('document'),

    document_id: UuidSchema,
    display_name: z.string(),
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
    thumbnail_urls: ThumbnailUrlsSchema.nullable(),
    blurhash: z.string().nullable(),

    // Metadata
    size_bytes: z.number(),
    tags: z.array(z.string()),

    // Relevance (for text searches)
    relevance: z.number().nullable(),
});

export type DocumentSearchResult = z.infer<typeof DocumentSearchResultSchema>;

// Back-compat alias: existing document-centric consumers refer to a document hit as `SearchResult`.
export const SearchResultSchema = DocumentSearchResultSchema;
export type SearchResult = DocumentSearchResult;

// A single collection/folder hit (from the `folders` table, discriminated by `folder_type`).
export const CollectionSearchResultSchema = z.object({
    result_type: z.literal('collection'),

    id: UuidSchema,
    name: z.string(),
    path: z.string(),
    description: z.string().nullable(),
    emoji: z.string().nullable(),
    folder_type: FolderTypeSchema, // 'collection' | 'folder'
    document_count: z.number(),

    // Highlighted excerpt of the matched name/description
    snippet: z.string().nullable(),

    // Relevance (for text searches) — used to interleave with documents
    relevance: z.number().nullable(),
});

export type CollectionSearchResult = z.infer<typeof CollectionSearchResultSchema>;

// Unified search hit: documents and collections/folders interleaved by relevance.
export const SearchHitSchema = z.discriminatedUnion('result_type', [DocumentSearchResultSchema, CollectionSearchResultSchema]);

export type SearchHit = z.infer<typeof SearchHitSchema>;

// ============================================================================
// Facets
// ============================================================================

/**
 * A single facet value with its query-narrowed count.
 *
 * Semantics (computed backend-side in search/facets.ts):
 * - `count` applies every active filter EXCEPT the facet's own dimension, so it
 *   answers "how many results if I click this?" (facet count === result count).
 * - `selected` means the value is present in the query's positive filters.
 * - Selected values are always returned, even as `{ count: 0, selected: true }`,
 *   so a checked filter entry never disappears from the UI. Zero-count
 *   unselected values are omitted.
 */
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

    // Location facets (countries/cities with photo metadata)
    locations: z.array(FacetItemSchema).optional(),
});

export type SearchFacets = z.infer<typeof SearchFacetsSchema>;

// ============================================================================
// Search Response
// ============================================================================

export const SearchResponseSchema = z.object({
    total: z.number(),
    results: z.array(SearchHitSchema),
    facets: SearchFacetsSchema.optional(),
    query: ParsedQuerySchema.optional(), // Parsed query for debugging
    timing_ms: z.number(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ============================================================================
// Suggestions / Autocomplete
// ============================================================================

export const SuggestionTypeEnum = z.enum(['filename', 'folder', 'tag', 'entity', 'category', 'location']);
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

// ============================================================================
// Quick filters and help
// ============================================================================

/**
 * A predefined search shortcut with its live result count. Counts run through
 * the real search count path, so a chip's count always equals what clicking it
 * returns; zero-count candidates are dropped backend-side.
 */
export const QuickFilterSchema = z.object({
    id: z.string(),
    label: z.string(),
    query: z.string(),
    icon: z.string().optional(),
    count: z.number(),
});

export type QuickFilter = z.infer<typeof QuickFilterSchema>;

export const QuickFiltersResponseSchema = z.array(QuickFilterSchema);

export const SearchHelpFilterSchema = z.object({
    name: z.string(),
    syntax: z.string(),
    examples: z.array(z.string()),
    description: z.string(),
});

export type SearchHelpFilter = z.infer<typeof SearchHelpFilterSchema>;

export const SearchHelpSchema = z.object({
    filters: z.array(SearchHelpFilterSchema),
    examples: z.array(z.object({ query: z.string(), description: z.string() })),
});

export type SearchHelp = z.infer<typeof SearchHelpSchema>;
