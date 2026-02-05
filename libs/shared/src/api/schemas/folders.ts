import { z } from 'zod'
import { UuidSchema } from './common.js'

export const FolderSchema = z.object({
  id: UuidSchema,
  parent_id: UuidSchema.nullable(),
  name: z.string().min(1).max(255),
  path: z.string(),
  description: z.string().nullable(),
  emoji: z.string().max(8).nullable(),
  sort_order: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type Folder = z.infer<typeof FolderSchema>

export const CreateFolderRequestSchema = z.object({
  name: z.string().min(1).max(255),
  parent_id: UuidSchema.optional(),
  description: z.string().optional(),
  emoji: z.string().max(8).optional(),
})

export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>

export const UpdateFolderRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  emoji: z.string().max(8).nullable().optional(),
  parent_id: UuidSchema.nullable().optional(),
})

export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>

export const ReorderSectionsRequestSchema = z.object({
  updates: z.array(
    z.object({
      id: UuidSchema,
      sort_order: z.number(),
    }),
  ).min(1).max(500),
})

export type ReorderSectionsRequest = z.infer<typeof ReorderSectionsRequestSchema>

export interface FolderWithChildren extends z.infer<typeof FolderSchema> {
  children: FolderWithChildren[]
  document_count: number
}

export const FolderWithChildrenSchema: z.ZodType<FolderWithChildren> = FolderSchema.extend({
  children: z.lazy(() => z.array(FolderWithChildrenSchema)),
  document_count: z.number(),
})



