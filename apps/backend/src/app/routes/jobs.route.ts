import { JobBatchResponseSchema, JobSchema } from '@reverie/shared';
import { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getJobService } from '../../jobs/job.service';
import { fetchLockedDocuments } from '../../services/document-access';
import { loadFolderLocks } from '../../services/folder-locks';

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
                    200: JobSchema,
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
            const userId = request.user.id;

            const job = await jobService.getJob(id, userId);

            // A job's result and error text can quote the document, so it follows the document's lock.
            if (job?.target_type === 'document') {
                const locks = await loadFolderLocks(fastify, request, userId);
                const lockedFolderId = (await fetchLockedDocuments(locks, userId, [job.target_id])).get(job.target_id);

                if (lockedFolderId) locks.assertOpen(lockedFolderId);
            }

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
            const userId = request.user.id;

            const allJobs = await jobService.getJobsByIds(jobIds, userId);
            const locks = await loadFolderLocks(fastify, request, userId);
            const lockedDocuments = await fetchLockedDocuments(
                locks,
                userId,
                allJobs.map((job) => job.target_id),
            );
            const jobs = allJobs.filter((job) => !lockedDocuments.has(job.target_id));

            return jobs.map((job) => ({
                id: job.id,
                status: job.status,
                // Progress is estimated based on status
                progress: job.status === 'complete' ? 100 : job.status === 'processing' ? 50 : job.status === 'failed' ? 0 : 0,
            }));
        },
    );
}
