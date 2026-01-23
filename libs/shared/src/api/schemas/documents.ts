import { z } from 'zod'
import { DateOnlySchema, PaginationQuerySchema, UuidSchema } from './common.js'
import { JobStatusEnum } from './jobs.js'

export const DocumentCategoryEnum = z.enum([
  'stock_overview',
  'stock_split',
  'dividend_statement',
  'transaction_receipt',
  'other',
])

export type DocumentCategory = z.infer<typeof DocumentCategoryEnum>

export const ThumbnailPathsSchema = z.object({
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
})

export type ThumbnailPaths = z.infer<typeof ThumbnailPathsSchema>

export const DocumentSchema = z.object({
  id: UuidSchema,
  folder_id: UuidSchema.nullable(),
  file_path: z.string(),
  file_hash: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  thumbnail_blurhash: z.string().nullable(),
  thumbnail_paths: ThumbnailPathsSchema.nullable(),
  document_category: DocumentCategoryEnum.nullable(),
  extracted_date: DateOnlySchema.nullable(),
  ocr_status: JobStatusEnum,
  thumbnail_status: JobStatusEnum,
  llm_summary: z.string().nullable(),
  llm_metadata: z.record(z.unknown()).nullable(),
  llm_processed_at: z.string().datetime().nullable(),
  llm_token_count: z.number().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type Document = z.infer<typeof DocumentSchema>

export const DocumentListQuerySchema = PaginationQuerySchema.extend({
  folder_id: UuidSchema.optional(),
  category: DocumentCategoryEnum.optional(),
  date_from: DateOnlySchema.optional(),
  date_to: DateOnlySchema.optional(),
})

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>

export const DocumentStatusResponseSchema = z.object({
  document_id: UuidSchema,
  ocr_status: JobStatusEnum,
  thumbnail_status: JobStatusEnum,
  jobs: z.array(
    z.object({
      type: z.string(),
      status: JobStatusEnum,
      progress: z.number().optional(),
      completed_at: z.string().datetime().optional(),
    })
  ),
})

export type DocumentStatusResponse = z.infer<typeof DocumentStatusResponseSchema>



