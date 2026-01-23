import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { checkDbConnection } from '../../db/kysely'

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.string().datetime(),
  version: z.string(),
  uptime: z.number(),
  services: z.object({
    database: z.enum(['ok', 'down']),
  }),
})

type HealthResponse = z.infer<typeof HealthResponseSchema>

const startTime = Date.now()

export default async function (fastify: FastifyInstance) {
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async function () {
      const dbOk = await checkDbConnection()

      return {
        status: dbOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '0.0.1',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        services: {
          database: dbOk ? 'ok' : 'down',
        },
      }
    }
  )
}

