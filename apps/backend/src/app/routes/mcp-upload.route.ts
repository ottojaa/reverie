import { AppError } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { uploadByLink } from '../../mcp/upload-by-link.js';

// Keyed by address, which behind the reverse proxy is the same for everyone, so in production this is one
// shared limit. Enough for one owner; a link is 256 random bits and works once.
const rateLimit = {
    max: 30,
    timeWindow: '1 minute',
    // Its own code and wording in place of the plugin's.
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Too many upload requests, try again in a minute'),
};

/** POST /mcp/upload: the files behind an upload_local_files call. The one-time link is the whole authentication. */
export default async function (fastify: FastifyInstance) {
    fastify.post('/mcp/upload', { config: { rateLimit }, schema: { hide: true } }, async (request) => uploadByLink(request));
}
