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
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { FastifyInstance } from 'fastify';
import { extname } from 'path';
import { env } from '../../config/env';
import { getStorage } from '../../storage';
import { LocalStorageProvider } from '../../storage/local-storage';
import { getStorageService } from '../../services/storage.service';

const storageService = getStorageService();
const storage = getStorage();

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
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
};

function getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();

    return MIME_TYPES[ext] || 'application/octet-stream';
}

type ByteRange = { start: number; end: number };

/**
 * Parse a single HTTP `Range` header against a known file size.
 * Returns null when absent (serve full 200), 'invalid' when unsatisfiable
 * (416), or the resolved byte range. Only single ranges are handled — a
 * multi-range request falls back to a full 200 body, which is valid per RFC
 * 7233 and matches what ExoPlayer/browsers issue in practice.
 */
function parseByteRange(header: string | undefined, size: number): ByteRange | 'invalid' | null {
    if (!header) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

    if (!match) return null;

    const [, startRaw = '', endRaw = ''] = match;

    if (startRaw === '' && endRaw === '') return 'invalid';

    // Suffix form `bytes=-N`: the last N bytes.
    if (startRaw === '') {
        const suffix = parseInt(endRaw, 10);

        if (suffix <= 0) return 'invalid';

        const start = Math.max(0, size - suffix);

        return { start, end: size - 1 };
    }

    const start = parseInt(startRaw, 10);
    const end = endRaw === '' ? size - 1 : Math.min(parseInt(endRaw, 10), size - 1);

    if (start > end || start >= size) return 'invalid';

    return { start, end };
}

export default async function (fastify: FastifyInstance) {
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

            const contentType = getMimeType(filePath);

            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'private, max-age=86400, immutable');
            reply.header('X-Content-Type-Options', 'nosniff');

            // Force a download (attachment) only when ?download=1 is present; otherwise serve
            // inline so the viewer can render images/video/PDF. Mirrors the prod nginx behavior.
            if (download) {
                const name = dl ? decodeURIComponent(dl) : filePath.split('/').pop()!;

                reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
            }

            // Advertise range support (and honor a single range) so clients that seek —
            // ExoPlayer, browsers scrubbing a video — work against the dev route the same
            // way they do against prod nginx.
            reply.header('Accept-Ranges', 'bytes');

            try {
                if (storage instanceof LocalStorageProvider) {
                    const absolutePath = storage.getAbsolutePath(filePath);
                    const stats = await stat(absolutePath);
                    const range = parseByteRange(request.headers.range, stats.size);

                    if (range === 'invalid') {
                        return reply.status(416).header('Content-Range', `bytes */${stats.size}`).send({ error: 'Requested range not satisfiable' });
                    }

                    if (range) {
                        reply.status(206);
                        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
                        reply.header('Content-Length', String(range.end - range.start + 1));

                        return reply.send(createReadStream(absolutePath, { start: range.start, end: range.end }));
                    }

                    reply.header('Content-Length', String(stats.size));

                    return reply.send(createReadStream(absolutePath));
                }

                const buffer = await storageService.readFile(filePath);
                const range = parseByteRange(request.headers.range, buffer.length);

                if (range === 'invalid') {
                    return reply.status(416).header('Content-Range', `bytes */${buffer.length}`).send({ error: 'Requested range not satisfiable' });
                }

                if (range) {
                    reply.status(206);
                    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${buffer.length}`);

                    return reply.send(buffer.subarray(range.start, range.end + 1));
                }

                return reply.send(buffer);
            } catch (_error) {
                return reply.status(404).send({ error: 'File not found' });
            }
        },
    );
}
