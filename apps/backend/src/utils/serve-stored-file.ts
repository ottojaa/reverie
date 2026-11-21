import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { extname } from 'path';
import { getStorage } from '../storage';
import { LocalStorageProvider } from '../storage/local-storage';
import { getStorageService } from '../services/storage.service';

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
    // HLS renditions: the playlists, and the fMP4 segments (.m4s) and init files (.mp4) they list.
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.m4s': 'video/mp4',
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

/**
 * Sends a stored file with its MIME type, honouring a single `Range` request: from disk as a stream for local
 * storage, buffered for S3. Sends 404 when the file is missing. The caller has already checked access and set
 * its own cache and disposition headers.
 */
export async function sendStoredFile(request: FastifyRequest, reply: FastifyReply, storagePath: string): Promise<FastifyReply> {
    reply.header('Content-Type', getMimeType(storagePath));
    reply.header('X-Content-Type-Options', 'nosniff');

    // Advertise range support (and honor a single range) so clients that seek —
    // ExoPlayer, browsers scrubbing a video — work against the dev route the same
    // way they do against prod nginx.
    reply.header('Accept-Ranges', 'bytes');

    try {
        const storage = getStorage();

        if (storage instanceof LocalStorageProvider) {
            const absolutePath = storage.getAbsolutePath(storagePath);
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

        const buffer = await getStorageService().readFile(storagePath);
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
        // The file's own Content-Type is already set, and an object body needs JSON.
        return reply.status(404).type('application/json').send({ error: 'File not found' });
    }
}
