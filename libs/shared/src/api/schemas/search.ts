import { z } from 'zod'
import { UuidSchema, DateOnlySchema, PaginationQuerySchema } from './common.js'
import { DocumentCategoryEnum } from './documents.js'

export const SearchQuerySchema = PaginationQuerySchema.extend({
  q: z.string().min(1),
  category: DocumentCategoryEnum.optional(),
  date_from: DateOnlySchema.optional(),
  date_to: DateOnlySchema.optional(),
  folder_id: UuidSchema.optional(),
  sort_by: z.enum(['relevance', 'date', 'filename']).default('relevance'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
})

export type SearchQuery = z.infer<typeof SearchQuerySchema>

export const SearchResultSchema = z.object({
  document_id: UuidSchema,
  filename: z.string(),
  folder_path: z.string().nullable(),
  extracted_date: DateOnlySchema.nullable(),
  category: DocumentCategoryEnum.nullable(),
  snippet: z.string(),
  relevance: z.number(),
  thumbnail_url: z.string().nullable(),
  thumbnail_blurhash: z.string().nullable(),
})

export type SearchResult = z.infer<typeof SearchResultSchema>

export const SearchFacetsSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      count: z.number(),
    })
  ),
  companies: z.array(
    z.object({
      name: z.string(),
      count: z.number(),
    })
  ),
  years: z.array(
    z.object({
      year: z.number(),
      count: z.number(),
    })
  ),
  tags: z.array(
    z.object({
      name: z.string(),
      count: z.number(),
    })
  ),
})

export type SearchFacets = z.infer<typeof SearchFacetsSchema>

export const SearchResponseSchema = z.object({
  total: z.number(),
  results: z.array(SearchResultSchema),
  facets: SearchFacetsSchema,
})

export type SearchResponse = z.infer<typeof SearchResponseSchema>

export const SuggestResponseSchema = z.array(z.string())

export type SuggestResponse = z.infer<typeof SuggestResponseSchema>



