import { AppError } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { uploadByLink } from '../../mcp/upload-by-link.js';
import { toAddressKey } from '../plugins/rate-limit.js';

// Keyed by client address (one count for everyone behind a reverse proxy that `TRUST_PROXY` doesn't list).
// Enough for one owner; a link is 256 random bits and works once.
const rateLimit = {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: toAddressKey,
    // Its own code and wording in place of the plugin's.
    errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Too many upload requests, try again in a minute'),
};

/** POST /mcp/upload: the files behind an upload_local_files call. The one-time link is the whole authentication. */
export default async function (fastify: FastifyInstance) {
    fastify.post('/mcp/upload', { config: { rateLimit }, schema: { hide: true } }, async (request) => uploadByLink(request));
}
