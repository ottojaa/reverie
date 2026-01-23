import { z } from 'zod'

export const JobStatusEnum = z.enum(['pending', 'processing', 'complete', 'failed'])
export type JobStatus = z.infer<typeof JobStatusEnum>

export const JobTypeEnum = z.enum(['ocr', 'thumbnail', 'llm_summary'])
export type JobType = z.infer<typeof JobTypeEnum>

export const JobSchema = z.object({
  id: z.string().uuid(),
  job_type: JobTypeEnum,
  target_type: z.enum(['document', 'folder']),
  target_id: z.string().uuid(),
  status: JobStatusEnum,
  priority: z.number().default(0),
  attempts: z.number().default(0),
  error_message: z.string().nullable(),
  result: z.unknown().nullable(),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
})

export type Job = z.infer<typeof JobSchema>

export const JobBatchQuerySchema = z.object({
  ids: z.string().transform((val) => val.split(',')),
})

export type JobBatchQuery = z.infer<typeof JobBatchQuerySchema>

export const JobBatchResponseSchema = z.array(
  z.object({
    id: z.string().uuid(),
    status: JobStatusEnum,
    progress: z.number().min(0).max(100).optional(),
  })
)

export type JobBatchResponse = z.infer<typeof JobBatchResponseSchema>



