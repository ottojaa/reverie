import { Job, Worker } from 'bullmq';
import { spawn } from 'child_process';
import { mkdtemp, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '../db/kysely';
import { NonRetryableJobError } from '../jobs/job.types';
import { QUEUE_CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { getRedisConnectionOptions } from '../queues/redis';
import type { TrimJobData, TrimJobResult } from '../queues/trim.queue';
import { getUploadService } from '../services/upload.service';
import { getFileCategory, getStorageService } from '../services/storage.service';
import { createWorkerLogger, processJobWithTracking } from './worker.utils';

const logger = createWorkerLogger('Trim');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']);

function isVideoDocument(mimeType: string, filename: string): boolean {
    if (getFileCategory(mimeType) === 'video') return true;

    const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

    return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Trim video using FFmpeg stream copy (fast, no re-encode)
 */
async function trimVideoWithFfmpeg(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    endSeconds: number,
): Promise<void> {
    const args = ['-ss', String(startSeconds), '-i', inputPath, '-to', String(endSeconds - startSeconds), '-c', 'copy', '-y', outputPath];

    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrChunks: Buffer[] = [];
    ffmpeg.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    await new Promise<void>((resolve, reject) => {
        ffmpeg.on('error', (err) => reject(err));
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8').slice(-500)}`));
        });
    });
}

async function processTrimJob(job: Job<TrimJobData>): Promise<TrimJobResult> {
    const { documentId, userId, start, end, saveAsCopy, sessionId } = job.data;
    const storageService = getStorageService();
    const uploadService = getUploadService();

    logger.info('Processing trim job', { documentId, start, end, saveAsCopy });

    const document = await db.selectFrom('documents').selectAll().where('id', '=', documentId).where('user_id', '=', userId).executeTakeFirst();

    if (!document) {
        throw new NonRetryableJobError(`Document ${documentId} not found`);
    }

    if (!isVideoDocument(document.mime_type, document.original_filename)) {
        throw new NonRetryableJobError('Document is not a video');
    }

    if (start >= end || start < 0 || end <= 0) {
        throw new NonRetryableJobError('Invalid trim range: start must be less than end');
    }

    const videoBuffer = await storageService.readFile(document.file_path);
    const ext = document.original_filename.slice(document.original_filename.lastIndexOf('.'));
    const tmpDir = await mkdtemp(join(tmpdir(), 'reverie-trim-'));
    const inputPath = join(tmpDir, `input${ext}`);
    const outputPath = join(tmpDir, `output${ext}`);

    try {
        await writeFile(inputPath, videoBuffer);
        await trimVideoWithFfmpeg(inputPath, outputPath, start, end);
        const trimmedBuffer = await readFile(outputPath);

        if (saveAsCopy) {
            if (!document.folder_id) {
                throw new NonRetryableJobError('Document must be in a folder to save as copy');
            }

            const result = await uploadService.uploadFiles(
                [
                    {
                        buffer: trimmedBuffer,
                        filename: document.original_filename,
                        mimetype: document.mime_type,
                    },
                ],
                userId,
                document.folder_id,
                sessionId,
                'keep_both',
                documentId,
            );

            const newDoc = result.documents[0];

            if (!newDoc) {
                throw new NonRetryableJobError('Failed to create new document');
            }

            logger.info('Trim job completed (copy)', { documentId, newDocumentId: newDoc.id });

            return { newDocumentId: newDoc.id };
        }

        await uploadService.replaceDocumentFile(documentId, userId, {
            buffer: trimmedBuffer,
            filename: document.original_filename,
            mimetype: document.mime_type,
        });

        logger.info('Trim job completed (overwrite)', { documentId });

        return {};
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes('ffmpeg')) {
            throw new NonRetryableJobError(`FFmpeg failed: ${msg}`);
        }

        throw err;
    } finally {
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
    }
}

export function createTrimWorker(): Worker<TrimJobData, TrimJobResult> {
    const worker = new Worker<TrimJobData, TrimJobResult>(QUEUE_NAMES.TRIM, async (job) => processJobWithTracking(job, processTrimJob), {
        connection: getRedisConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.TRIM],
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

    logger.info('Trim worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.TRIM] });

    return worker;
}
