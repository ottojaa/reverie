import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.string().datetime(),
  version: z.string(),
  uptime: z.number(),
});

type HealthResponse = z.infer<typeof HealthResponseSchema>;

const startTime = Date.now();

export default async function (fastify: FastifyInstance) {
  fastify.get<{ Reply: HealthResponse }>('/health', async function () {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });
}

