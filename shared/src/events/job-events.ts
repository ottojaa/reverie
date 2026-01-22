import { z } from 'zod'
import { JobStatusEnum } from '../api/schemas/jobs.js'

export const JobEventTypeEnum = z.enum([
  'job:started',
  'job:progress',
  'job:complete',
  'job:failed',
])

export type JobEventType = z.infer<typeof JobEventTypeEnum>

export const JobEventSchema = z.object({
  type: JobEventTypeEnum,
  job_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  folder_id: z.string().uuid().optional(),
  session_id: z.string().optional(),
  status: JobStatusEnum,
  progress: z.number().min(0).max(100).optional(),
  error_message: z.string().optional(),
  result: z.unknown().optional(),
  timestamp: z.string().datetime(),
})

export type JobEvent = z.infer<typeof JobEventSchema>


