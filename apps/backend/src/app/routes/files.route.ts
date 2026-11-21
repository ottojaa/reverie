/**
 * File serving route for local development
 *
 * In production, nginx handles /files/* requests with secure_link verification.
 * This route provides the same functionality for local development without nginx.
 *
 * Local storage streams files with sendfile-friendly streams; S3 falls back to
 * buffering (production typically uses nginx or CDN in front of object storage).
 */
import { createHash } from 'crypto';
import { FastifyInstance } from 'fastify';
import { env } from '../../config/env';
import { toSetPrefix } from '../../transcode/repository';
import { isSetFilePath, verifyHlsToken } from '../../storage/hls-token';
import { sendStoredFile } from '../../utils/serve-stored-file';

export default async function (fastify: FastifyInstance) {
    // Serve a video's HLS renditions with the token in the path, so the playlists' relative URLs carry it.
    // URL format: /files/hls/{expires}/{signature}/{fileHash}/{path inside the set}
    // Mirrors the nginx location in config/nginx/api.reverieapp.dev.conf, CORS aside (the cors plugin does that here).
    fastify.get<{
        Params: { exp: string; sig: string; key: string; '*': string };
    }>(
        '/files/hls/:exp/:sig/:key/*',
        {
            schema: {
                description: 'Serve HLS renditions with a signed path token (development fallback)',
                hide: true, // Hide from OpenAPI docs
            },
        },
        async function (request, reply) {
            const { exp, sig, key, '*': rest } = request.params;
            const check = verifyHlsToken(exp, sig, key);

            if (check === 'invalid') {
                return reply.status(403).send({ error: 'Invalid signature' });
            }

            if (check === 'expired') {
                return reply.status(410).send({ error: 'URL has expired' });
            }

            if (!isSetFilePath(rest)) {
                return reply.status(404).send({ error: 'File not found' });
            }

            // Segments never change under their path (a set is keyed by its content hash), so they cache for as long as nginx says.
            reply.header('Cache-Control', 'private, max-age=86400, immutable');

            return sendStoredFile(request, reply, `${toSetPrefix(key)}/${rest}`);
        },
    );

    // Serve files with signed URL verification
    // URL format: /files/{path}?e={expires}&s={signature}
    fastify.get<{
        Params: { '*': string };
        Querystring: { e?: string; s?: string; download?: string; dl?: string };
    }>(
        '/files/*',
        {
            schema: {
                description: 'Serve files with signed URL verification (development fallback)',
                hide: true, // Hide from OpenAPI docs
            },
        },
        async function (request, reply) {
            const filePath = request.params['*'];
            const { e: expires, s: signature, download, dl } = request.query;

            // Validate required parameters
            if (!expires || !signature) {
                return reply.status(403).send({ error: 'Missing signature parameters' });
            }

            // Check expiration
            const expiresTimestamp = parseInt(expires, 10);
            const now = Math.floor(Date.now() / 1000);

            if (isNaN(expiresTimestamp) || now > expiresTimestamp) {
                return reply.status(410).send({ error: 'URL has expired' });
            }

            // Verify signature (must match nginx secure_link_md5 format)
            const uri = `/files/${filePath}`;
            const stringToSign = `${expires}${uri}${env.FILE_URL_SECRET}`;
            const expectedSignature = createHash('md5').update(stringToSign).digest('base64url');

            if (signature !== expectedSignature) {
                return reply.status(403).send({ error: 'Invalid signature' });
            }

            reply.header('Cache-Control', 'private, max-age=86400, immutable');

            // Force a download (attachment) only when ?download=1 is present; otherwise serve
            // inline so the viewer can render images/video/PDF. Mirrors the prod nginx behavior.
            if (download) {
                const name = dl ? decodeURIComponent(dl) : filePath.split('/').pop()!;

                reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
            }

            return sendStoredFile(request, reply, filePath);
        },
    );
}
