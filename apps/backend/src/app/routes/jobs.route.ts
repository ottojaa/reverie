import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getJobService } from '../../jobs/job.service'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

// Schemas
const JobStatusEnum = z.enum(['pending', 'processing', 'complete', 'failed'])

const JobResponseSchema = z.object({
  id: z.string().uuid(),
  job_type: z.string(),
  target_type: z.string(),
  target_id: z.string().uuid(),
  status: JobStatusEnum,
  priority: z.number(),
  attempts: z.number(),
  error_message: z.string().nullable(),
  result: z.unknown().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
})

const JobBatchResponseSchema = z.array(
  z.object({
    id: z.string().uuid(),
    status: JobStatusEnum,
    progress: z.number().min(0).max(100).optional(),
  })
)

const DocumentStatusResponseSchema = z.object({
  document_id: z.string().uuid(),
  ocr_status: JobStatusEnum.nullable(),
  thumbnail_status: JobStatusEnum.nullable(),
  jobs: z.array(
    z.object({
      type: z.string(),
      status: JobStatusEnum,
      completed_at: z.string().nullable(),
    })
  ),
})

export default async function jobsRoute(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()
  const jobService = getJobService()

  // Get a single job by ID
  app.get(
    '/jobs/:id',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get job by ID',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: JobResponseSchema,
          404: z.object({
            statusCode: z.number(),
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const job = await jobService.getJob(id)

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Job ${id} not found`,
        })
      }

      return {
        ...job,
        created_at: job.created_at.toISOString(),
        started_at: job.started_at?.toISOString() ?? null,
        completed_at: job.completed_at?.toISOString() ?? null,
      }
    }
  )

  // Get multiple jobs by IDs (batch)
  app.get(
    '/jobs/batch',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get multiple jobs by IDs',
        querystring: z.object({
          ids: z.string().describe('Comma-separated list of job IDs'),
        }),
        response: {
          200: JobBatchResponseSchema,
        },
      },
    },
    async (request) => {
      const { ids } = request.query
      const jobIds = ids.split(',').filter(Boolean)

      const jobs = await jobService.getJobsByIds(jobIds)

      return jobs.map((job) => ({
        id: job.id,
        status: job.status,
        // Progress is estimated based on status
        progress:
          job.status === 'complete'
            ? 100
            : job.status === 'processing'
              ? 50
              : job.status === 'failed'
                ? 0
                : 0,
      }))
    }
  )

  // Get document processing status
  app.get(
    '/documents/:id/status',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get document processing status',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: DocumentStatusResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params

      const status = await jobService.getDocumentProcessingStatus(id)

      return {
        document_id: status.documentId,
        ocr_status: status.ocrStatus,
        thumbnail_status: status.thumbnailStatus,
        jobs: status.jobs.map((j) => ({
          type: j.type,
          status: j.status,
          completed_at: j.completedAt?.toISOString() ?? null,
        })),
      }
    }
  )

  // Get all jobs for a document
  app.get(
    '/documents/:id/jobs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get all jobs for a document',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: z.array(JobResponseSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params

      const jobs = await jobService.getJobsForDocument(id)

      return jobs.map((job) => ({
        ...job,
        created_at: job.created_at.toISOString(),
        started_at: job.started_at?.toISOString() ?? null,
        completed_at: job.completed_at?.toISOString() ?? null,
      }))
    }
  )
}

