import { AppError } from '@reverie/shared'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { ZodError } from 'zod'

export default fp(async function (fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    // Handle AppError
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toJSON())
    }

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.flatten(),
      })
    }

    // Handle Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      })
    }

    // Log unexpected errors
    fastify.log.error(error)

    // Return generic error for unhandled cases
    return reply.status(500).send({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    })
  })
})


