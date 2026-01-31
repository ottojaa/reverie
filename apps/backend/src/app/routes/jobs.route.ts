import { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getJobService } from '../../jobs/job.service';

// Schemas
const JobStatusEnum = z.enum(['pending', 'processing', 'complete', 'failed']);

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
});

const JobBatchResponseSchema = z.array(
    z.object({
        id: z.string().uuid(),
        status: JobStatusEnum,
        progress: z.number().min(0).max(100).optional(),
    }),
);

export default async function jobsRoute(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const jobService = getJobService();

    // Get a single job by ID (requires authentication)
    app.get(
        '/jobs/:id',
        {
            preHandler: [fastify.authenticate],
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
            const { id } = request.params;

            const job = await jobService.getJob(id);

            if (!job) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: 'Not Found',
                    message: `Job ${id} not found`,
                });
            }

            return {
                ...job,
                created_at: job.created_at.toISOString(),
                started_at: job.started_at?.toISOString() ?? null,
                completed_at: job.completed_at?.toISOString() ?? null,
            };
        },
    );

    // Get multiple jobs by IDs (batch) (requires authentication)
    app.get(
        '/jobs/batch',
        {
            preHandler: [fastify.authenticate],
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
            const { ids } = request.query;
            const jobIds = ids.split(',').filter(Boolean);

            const jobs = await jobService.getJobsByIds(jobIds);

            return jobs.map((job) => ({
                id: job.id,
                status: job.status,
                // Progress is estimated based on status
                progress: job.status === 'complete' ? 100 : job.status === 'processing' ? 50 : job.status === 'failed' ? 0 : 0,
            }));
        },
    );
}
