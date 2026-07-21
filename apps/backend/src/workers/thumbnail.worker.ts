import { THUMBNAIL_SIZES, VIDEO_POSTER_FRAME_SECONDS } from '@reverie/shared';
import { encode } from 'blurhash';
import { Job, Worker } from 'bullmq';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import sharp from 'sharp';
import { db } from '../db/kysely';
import { NonRetryableJobError } from '../jobs/job.types';
import { decodeTextForPreview } from '../ocr/text-extractor';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import type { ThumbnailJobData, ThumbnailJobResult } from '../queues/thumbnail.queue';
import { getStorageService } from '../services/storage.service';
import { getThumbnailStrategy } from '../services/thumbnail-strategy';
import { createWorkerLogger, processJobWithTracking, publishJobProgress } from './worker.utils';

const logger = createWorkerLogger('Thumbnail');

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
 * Extract a single frame from video buffer using ffmpeg, and probe its duration with ffprobe
 * (both must be on PATH — they ship together). Duration is a best-effort extra: a probe failure
 * yields null rather than failing the whole thumbnail job.
 */
async function renderVideoFrame(videoBuffer: Buffer, mimeType: string): Promise<{ frame: Buffer; durationSeconds: number | null }> {
    const ext = VIDEO_MIME_TO_EXT[mimeType] ?? '.bin';
    const tmpDir = await mkdtemp(join(tmpdir(), 'reverie-video-'));
    const inputPath = join(tmpDir, `video${ext}`);

    try {
        await writeFile(inputPath, videoBuffer);

        const chunks: Buffer[] = [];
        // Grab the poster frame at the shared offset so the client's video open can park its first
        // rendered frame on the same frame (see VIDEO_POSTER_FRAME_MS).
        const ffmpeg = spawn('ffmpeg', ['-ss', VIDEO_POSTER_FRAME_SECONDS, '-i', inputPath, '-vframes', '1', '-f', 'image2', 'pipe:1', '-y'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

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

        // Probe while the temp file still exists (before the finally unlink).
        const durationSeconds = await probeVideoDuration(inputPath);

        return { frame: out, durationSeconds };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new NonRetryableJobError(`ffmpeg not found or failed to extract video frame: ${msg}`);
    } finally {
        await unlink(inputPath).catch(() => {});
    }
}

/** Probe a video's duration in seconds with ffprobe; null when it can't be determined. */
async function probeVideoDuration(inputPath: string): Promise<number | null> {
    try {
        const chunks: Buffer[] = [];
        const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath], {
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        ffprobe.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));

        await new Promise<void>((resolve, reject) => {
            ffprobe.on('error', (err) => reject(err));
            ffprobe.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffprobe exited ${code}`))));
        });

        const value = Number.parseFloat(Buffer.concat(chunks).toString('utf8').trim());

        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

// LibreOffice binary; overridable for local dev (macOS cask installs it off-PATH at
// /Applications/LibreOffice.app/Contents/MacOS/soffice). In the container it's `soffice`.
const LIBREOFFICE_BIN = process.env.LIBREOFFICE_BIN ?? 'soffice';
const OFFICE_CONVERT_TIMEOUT_MS = 90_000;

/** Spawn a command, capturing stderr and enforcing a hard timeout. */
function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const stderrChunks: Buffer[] = [];

        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timer);

            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8').slice(-500)}`));
        });
    });
}

/**
 * Convert an office document (docx/xlsx/pptx/odt/rtf/…) to PDF with headless LibreOffice
 * so it can flow through the existing PDF-first-page renderer.
 */
async function renderOfficeToPdf(fileBuffer: Buffer, filename: string): Promise<Buffer> {
    const ext = extname(filename) || '.bin';
    const workDir = await mkdtemp(join(tmpdir(), 'reverie-office-'));
    // soffice serialises on a shared profile lock — give each conversion its own
    // UserInstallation so concurrent thumbnail jobs don't block or corrupt one another.
    const profileDir = await mkdtemp(join(tmpdir(), 'reverie-lo-profile-'));
    const inputPath = join(workDir, `input${ext}`);

    try {
        await writeFile(inputPath, fileBuffer);

        await runCommand(
            LIBREOFFICE_BIN,
            ['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${profileDir}`, '--convert-to', 'pdf', '--outdir', workDir, inputPath],
            OFFICE_CONVERT_TIMEOUT_MS,
        );

        // soffice writes `<inputBasename>.pdf` (extension swapped) into outdir.
        try {
            const pdfBuffer = await readFile(join(workDir, 'input.pdf'));

            if (pdfBuffer.length === 0) {
                throw new NonRetryableJobError('LibreOffice produced an empty PDF');
            }

            return pdfBuffer;
        } catch (err) {
            if (err instanceof NonRetryableJobError) throw err;

            throw new NonRetryableJobError('LibreOffice produced no PDF output');
        }
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
}

// Text-preview page layout (portrait, ~letter aspect). Rendered as SVG then rasterised.
const TEXT_PREVIEW = { width: 800, height: 1035, padding: 40, headerHeight: 56, bodyFontSize: 15, lineHeight: 21, maxCharsPerLine: 92 } as const;

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Render the first screenful of a text/code file as a document-preview PNG. Uses an SVG
 * composed of one <text> per line, rasterised by sharp (needs a monospace font available
 * via fontconfig — see Dockerfile.ocr-base).
 */
async function renderTextPreview(text: string, filename: string): Promise<Buffer> {
    const { width, height, padding, headerHeight, bodyFontSize, lineHeight, maxCharsPerLine } = TEXT_PREVIEW;
    const bodyTop = headerHeight + 34;
    const maxLines = Math.max(1, Math.floor((height - bodyTop - padding) / lineHeight));

    // Normalise newlines, expand tabs, drop control chars that would break the SVG, clip to page.
    const normalized = text
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, '    ')
        // Intentionally match control chars — they would produce invalid SVG markup.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

    const bodyLines = normalized
        .split('\n')
        .slice(0, maxLines)
        .map((line, i) => {
            const clipped = line.length > maxCharsPerLine ? line.slice(0, maxCharsPerLine) : line;
            const y = bodyTop + i * lineHeight;

            // A single space keeps a blank line from collapsing its baseline.
            return `<text x="${padding}" y="${y}" fill="#374151" font-size="${bodyFontSize}" xml:space="preserve">${escapeXml(clipped) || ' '}</text>`;
        })
        .join('');

    const headerName = filename.length > 48 ? filename.slice(0, 47) + '…' : filename;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect width="${width}" height="${headerHeight}" fill="#f3f4f6"/>
  <rect y="${headerHeight}" width="${width}" height="2" fill="#6366f1"/>
  <g font-family="'DejaVu Sans Mono','Liberation Mono','Menlo','Consolas',monospace">
    <text x="${padding}" y="${Math.round(headerHeight / 2) + 6}" fill="#111827" font-size="18" font-weight="600">${escapeXml(headerName)}</text>
    ${bodyLines}
  </g>
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Produce the raster image (and its natural dimensions) that thumbnails are generated
 * from, routed by the shared thumbnail strategy. The upload gate only enqueues a job when
 * the strategy is thumbnailable, so `none` should never reach here.
 */
async function getImageBuffer(
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
): Promise<{ imageBuffer: Buffer; originalDimensions: { width: number; height: number }; durationSeconds: number | null }> {
    const strategy = getThumbnailStrategy(mimeType, filename);

    if (strategy === 'pdf' || strategy === 'office') {
        const pdfBuffer = strategy === 'office' ? await renderOfficeToPdf(fileBuffer, filename) : fileBuffer;
        const pngBuffer = await renderPdfFirstPage(pdfBuffer);
        const metadata = await sharp(pngBuffer).metadata();

        if (!metadata.width || !metadata.height) {
            throw new NonRetryableJobError('Could not get PDF page dimensions');
        }

        return { imageBuffer: pngBuffer, originalDimensions: { width: metadata.width, height: metadata.height }, durationSeconds: null };
    }

    if (strategy === 'video') {
        const { frame, durationSeconds } = await renderVideoFrame(fileBuffer, mimeType);
        const metadata = await sharp(frame).metadata();

        if (!metadata.width || !metadata.height) {
            throw new NonRetryableJobError('Could not get video frame dimensions');
        }

        return { imageBuffer: frame, originalDimensions: { width: metadata.width, height: metadata.height }, durationSeconds };
    }

    if (strategy === 'text') {
        const pngBuffer = await renderTextPreview(decodeTextForPreview(fileBuffer), filename);
        const metadata = await sharp(pngBuffer).metadata();

        if (!metadata.width || !metadata.height) {
            throw new NonRetryableJobError('Could not render text preview');
        }

        return { imageBuffer: pngBuffer, originalDimensions: { width: metadata.width, height: metadata.height }, durationSeconds: null };
    }

    // Images: use the original buffer directly.
    const metadata = await sharp(fileBuffer).metadata();

    if (!metadata.width || !metadata.height) {
        throw new NonRetryableJobError('Could not read image dimensions');
    }

    return { imageBuffer: fileBuffer, originalDimensions: { width: metadata.width, height: metadata.height }, durationSeconds: null };
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

    await publishJobProgress(job.id!, 10, documentId, job.data.sessionId, job.data.userId);

    // Read original file from storage
    const fileBuffer = await storageService.readFile(filePath);

    // Get image buffer based on file type (renders PDF/office/text as needed)
    const { imageBuffer, originalDimensions, durationSeconds } = await getImageBuffer(fileBuffer, document.mime_type, document.original_filename);

    await publishJobProgress(job.id!, 30, documentId, job.data.sessionId, job.data.userId);

    // Generate thumbnails in parallel
    const thumbnailPromises = Object.entries(THUMBNAIL_SIZES).map(async ([size, width]) => {
        const resized = await sharp(imageBuffer).resize(width, null, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();

        // Store thumbnail
        const thumbnailPath = `thumbnails/${documentId}/${size}.webp`;
        await storageService.writeFile(thumbnailPath, resized);

        return { size, path: thumbnailPath, bytes: resized.length };
    });

    const thumbnails = await Promise.all(thumbnailPromises);
    const totalThumbnailSize = thumbnails.reduce((sum, t) => sum + t.bytes, 0);
    await storageService.updateStorageUsage(document.user_id, totalThumbnailSize);

    await publishJobProgress(job.id!, 70, documentId, job.data.sessionId, job.data.userId);

    // Generate blurhash from smallest thumbnail
    const smallThumbnailBuffer = await sharp(imageBuffer).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const blurhash = encode(new Uint8ClampedArray(smallThumbnailBuffer.data), smallThumbnailBuffer.info.width, smallThumbnailBuffer.info.height, 4, 3);

    await publishJobProgress(job.id!, 90, documentId, job.data.sessionId, job.data.userId);

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
            duration_seconds: durationSeconds,
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

        if (!job) return;

        // Mark the document's thumbnail as failed once retries are exhausted (or the
        // error is non-retryable) so clients stop showing a "processing" state and fall
        // back to the file-type icon. The worker.utils tracker only updates the job row.
        const maxAttempts = job.opts.attempts ?? 1;
        const isTerminal = error?.name === 'NonRetryableJobError' || job.attemptsMade >= maxAttempts;

        if (!isTerminal) return;

        db.updateTable('documents')
            .set({ thumbnail_status: 'failed' })
            .where('id', '=', job.data.documentId)
            .execute()
            .catch((err) =>
                logger.error('Failed to mark thumbnail_status=failed', err instanceof Error ? err : undefined, { documentId: job.data.documentId }),
            );
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
