/**
 * File serving route for local development
 *
 * In production, nginx handles /files/* requests with secure_link verification.
 * This route provides the same functionality for local development without nginx.
 */
import { createHash } from 'crypto';
import { FastifyInstance } from 'fastify';
import { extname } from 'path';
import { env } from '../../config/env';
import { getStorageService } from '../../services/storage.service';

const storageService = getStorageService();

// Simple extension to MIME type mapping for common file types
const MIME_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
};

function getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

export default async function (fastify: FastifyInstance) {
    // Serve files with signed URL verification
    // URL format: /files/{path}?e={expires}&s={signature}
    fastify.get<{
        Params: { '*': string };
        Querystring: { e?: string; s?: string };
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
            const { e: expires, s: signature } = request.query;

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

            // Serve the file
            try {
                const buffer = await storageService.readFile(filePath);

                // Determine content type from file extension
                const contentType = getMimeType(filePath);

                reply.header('Content-Type', contentType);
                reply.header('Cache-Control', 'private, max-age=86400, immutable');
                reply.header('X-Content-Type-Options', 'nosniff');

                return reply.send(buffer);
            } catch (error) {
                return reply.status(404).send({ error: 'File not found' });
            }
        },
    );
}
