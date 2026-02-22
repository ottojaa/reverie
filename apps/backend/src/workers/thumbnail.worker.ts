import { encode } from 'blurhash';
import { Job, Worker } from 'bullmq';
import { spawn } from 'child_process';
import { mkdtemp, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { db } from '../db/kysely';
import { NonRetryableJobError } from '../jobs/job.types';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import type { ThumbnailJobData, ThumbnailJobResult } from '../queues/thumbnail.queue';
import { getFileCategory, getStorageService } from '../services/storage.service';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('Thumbnail');

// Thumbnail sizes
const THUMBNAIL_SIZES = {
    sm: 256,
    md: 512,
    lg: 1024,
} as const;

/**
 * Render first page of PDF to PNG buffer using pdf-to-img
 */
async function renderPdfFirstPage(pdfBuffer: Buffer): Promise<Buffer> {
    // pdf-to-img is ESM-only, use dynamic import
    const { pdf } = await import('pdf-to-img');

    // Convert buffer to data URL for pdf-to-img
    const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

    const document = await pdf(dataUrl, { scale: 2 });

    // Get first page
    const firstPage = await document.getPage(1);

    if (!firstPage) {
        throw new NonRetryableJobError('PDF has no pages');
    }

    return firstPage;
}

const VIDEO_MIME_TO_EXT: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
};

/**
 * Extract a single frame from video buffer using ffmpeg (must be on PATH)
 */
async function renderVideoFrame(videoBuffer: Buffer, mimeType: string): Promise<Buffer> {
    const ext = VIDEO_MIME_TO_EXT[mimeType] ?? '.bin';
    const tmpDir = await mkdtemp(join(tmpdir(), 'reverie-video-'));
    const inputPath = join(tmpDir, `video${ext}`);

    try {
        await writeFile(inputPath, videoBuffer);

        const chunks: Buffer[] = [];
        const ffmpeg = spawn('ffmpeg', ['-ss', '0.5', '-i', inputPath, '-vframes', '1', '-f', 'image2', 'pipe:1', '-y'], { stdio: ['ignore', 'pipe', 'pipe'] });

        ffmpeg.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));

        const stderrChunks: Buffer[] = [];
        ffmpeg.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        await new Promise<void>((resolve, reject) => {
            ffmpeg.on('error', (err) => reject(err));
            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8').slice(-500)}`));
            });
        });

        const out = Buffer.concat(chunks);

        if (out.length === 0) {
            throw new NonRetryableJobError('ffmpeg produced no output');
        }

        return out;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new NonRetryableJobError(`ffmpeg not found or failed to extract video frame: ${msg}`);
    } finally {
        await unlink(inputPath).catch(() => {});
    }
}

/**
 * Get image buffer for thumbnail generation based on file type
 */
async function getImageBuffer(fileBuffer: Buffer, mimeType: string): Promise<{ imageBuffer: Buffer; originalDimensions: { width: number; height: number } }> {
    const category = getFileCategory(mimeType);

    if (category === 'pdf') {
        // For PDFs, render first page as image
        const pngBuffer = await renderPdfFirstPage(fileBuffer);
        const metadata = await sharp(pngBuffer).metadata();

        if (!metadata.width || !metadata.height) {
            throw new NonRetryableJobError('Could not get PDF page dimensions');
        }

        return {
            imageBuffer: pngBuffer,
            originalDimensions: { width: metadata.width, height: metadata.height },
        };
    }

    if (category === 'video') {
        const pngBuffer = await renderVideoFrame(fileBuffer, mimeType);
        const metadata = await sharp(pngBuffer).metadata();

        if (!metadata.width || !metadata.height) {
            throw new NonRetryableJobError('Could not get video frame dimensions');
        }

        return {
            imageBuffer: pngBuffer,
            originalDimensions: { width: metadata.width, height: metadata.height },
        };
    }

    // For images, use buffer directly
    const metadata = await sharp(fileBuffer).metadata();

    if (!metadata.width || !metadata.height) {
        throw new NonRetryableJobError('Could not read image dimensions');
    }

    return {
        imageBuffer: fileBuffer,
        originalDimensions: { width: metadata.width, height: metadata.height },
    };
}

/**
 * Process a thumbnail generation job
 */
async function processThumbnailJob(job: Job<ThumbnailJobData>): Promise<ThumbnailJobResult> {
    const { documentId, filePath } = job.data;
    const storageService = getStorageService();

    logger.info('Processing thumbnail job', { documentId, filePath });

    // Verify document exists
    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();

    if (!document) {
        throw new NonRetryableJobError(`Document ${documentId} not found`);
    }

    await publishJobProgress(job.id!, 10, documentId, job.data.sessionId);

    // Read original file from storage
    const fileBuffer = await storageService.readFile(filePath);

    // Get image buffer based on file type (renders PDF first page if needed)
    const { imageBuffer, originalDimensions } = await getImageBuffer(fileBuffer, document.mime_type);

    await publishJobProgress(job.id!, 30, documentId, job.data.sessionId);

    // Generate thumbnails in parallel
    const thumbnailPromises = Object.entries(THUMBNAIL_SIZES).map(async ([size, width]) => {
        const resized = await sharp(imageBuffer).resize(width, null, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();

        // Store thumbnail
        const thumbnailPath = `thumbnails/${documentId}/${size}.webp`;
        await storageService.writeFile(thumbnailPath, resized);

        return { size, path: thumbnailPath };
    });

    const thumbnails = await Promise.all(thumbnailPromises);

    await publishJobProgress(job.id!, 70, documentId, job.data.sessionId);

    // Generate blurhash from smallest thumbnail
    const smallThumbnailBuffer = await sharp(imageBuffer).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const blurhash = encode(new Uint8ClampedArray(smallThumbnailBuffer.data), smallThumbnailBuffer.info.width, smallThumbnailBuffer.info.height, 4, 3);

    await publishJobProgress(job.id!, 90, documentId, job.data.sessionId);

    // Build result
    const paths = thumbnails.reduce(
        (acc, { size, path }) => {
            acc[size as keyof typeof THUMBNAIL_SIZES] = path;

            return acc;
        },
        {} as { sm: string; md: string; lg: string },
    );

    const result: ThumbnailJobResult = {
        blurhash,
        paths,
        originalDimensions,
    };

    // Update document with thumbnail info
    await db
        .updateTable('documents')
        .set({
            thumbnail_status: 'complete',
            thumbnail_blurhash: blurhash,
            thumbnail_paths: paths,
            width: originalDimensions.width,
            height: originalDimensions.height,
        })
        .where('id', '=', documentId)
        .execute();

    logger.info('Thumbnail job completed', {
        documentId,
        mimeType: document.mime_type,
        blurhash: blurhash.substring(0, 10) + '...',
    });

    return result;
}

/**
 * Create and start the thumbnail worker
 */
export function createThumbnailWorker(): Worker<ThumbnailJobData, ThumbnailJobResult> {
    const worker = new Worker<ThumbnailJobData, ThumbnailJobResult>(QUEUE_NAMES.THUMBNAIL, async (job) => processJobWithTracking(job, processThumbnailJob), {
        connection: getRedisConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.THUMBNAIL],
    });

    worker.on('completed', (job) => {
        logger.info('Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.error('Job failed', error, { jobId: job?.id });
    });

    worker.on('error', (error) => {
        logger.error('Worker error', error);
    });

    logger.info('Thumbnail worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.THUMBNAIL] });

    return worker;
}

// Run as standalone if executed directly
if (require.main === module) {
    createThumbnailWorker();
}
