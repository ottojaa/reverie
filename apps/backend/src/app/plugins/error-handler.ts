import { AppError, ValidationError } from '@reverie/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { STATUS_CODES } from 'node:http';
import { ZodError } from 'zod';

/** A status' name the way the envelope writes it, such as `TOO_MANY_REQUESTS`. */
function toErrorCode(status: number): string {
    return (STATUS_CODES[status] ?? 'Bad Request').toUpperCase().replace(/[^A-Z]+/g, '_');
}

/** The answer to an error that carries a 4xx status of its own. */
function toClientErrorAnswer(error: FastifyError, statusCode: number) {
    // The body parser's message quotes the body, which may hold a password, so none of it goes further.
    if (error instanceof SyntaxError) return new ValidationError('Request body is not valid JSON').toJSON();

    return { statusCode, error: toErrorCode(statusCode), message: error.message };
}

export default fp(async function (fastify: FastifyInstance) {
    fastify.setErrorHandler((error, _request, reply) => {
        // Handle AppError
        if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
        }

        // Handle Zod validation errors
        if (error instanceof ZodError) {
            return reply.status(400).send({
                statusCode: 400,
                error: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: error.flatten(),
            });
        }

        // Handle Fastify validation errors
        if (error.validation) {
            return reply.status(400).send({
                statusCode: 400,
                error: 'VALIDATION_ERROR',
                message: error.message,
                details: error.validation,
            });
        }

        const { statusCode } = error;

        // The request's fault, not the server's: the request log has the status, and nothing else is logged.
        if (statusCode && statusCode >= 400 && statusCode < 500) {
            return reply.status(statusCode).send(toClientErrorAnswer(error, statusCode));
        }

        // Log unexpected errors
        fastify.log.error(error);

        // Return generic error for unhandled cases
        return reply.status(500).send({
            statusCode: 500,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
        });
    });
});
