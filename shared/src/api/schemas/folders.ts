import { z } from 'zod'
import { UuidSchema } from './common.js'

export const FolderSchema = z.object({
  id: UuidSchema,
  parent_id: UuidSchema.nullable(),
  name: z.string().min(1).max(255),
  path: z.string(),
  description: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type Folder = z.infer<typeof FolderSchema>

export const CreateFolderRequestSchema = z.object({
  name: z.string().min(1).max(255),
  parent_id: UuidSchema.optional(),
  description: z.string().optional(),
})

export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>

export const UpdateFolderRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
})

export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>

export const FolderWithChildrenSchema = FolderSchema.extend({
  children: z.array(z.lazy(() => FolderSchema)),
  document_count: z.number(),
})

export type FolderWithChildren = z.infer<typeof FolderWithChildrenSchema>


