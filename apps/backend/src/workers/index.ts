export { createBackgroundOcrWorker, createOcrWorker } from './ocr.worker';
export { createBackgroundThumbnailWorker, createThumbnailWorker } from './thumbnail.worker';
export { createLlmWorker } from './llm.worker';
export { createTrimWorker } from './trim.worker';
export { createTrashWorker } from './trash.worker';
export { createEmbedWorker, startEmbedWorker } from './embed.worker';
export { createBackgroundTranscodeWorker, createTranscodeWorker } from './transcode.worker';
export * from './worker.utils';

import { createBackgroundOcrWorker, createOcrWorker } from './ocr.worker';
import { createBackgroundThumbnailWorker, createThumbnailWorker } from './thumbnail.worker';
import { createLlmWorker } from './llm.worker';
import { createTrimWorker } from './trim.worker';
import { createTrashWorker } from './trash.worker';
import { startEmbedWorker } from './embed.worker';
import { createBackgroundTranscodeWorker, createTranscodeWorker } from './transcode.worker';
import { createWorkerLogger } from './worker.utils';

const logger = createWorkerLogger('WorkerManager');

/**
 * Start all workers in a single process
 * Use this for development or simple deployments
 */
export function startAllWorkers() {
    logger.info('Starting all workers...');

    const ocrWorker = createOcrWorker();
    const backgroundOcrWorker = createBackgroundOcrWorker();
    const thumbnailWorker = createThumbnailWorker();
    const backgroundThumbnailWorker = createBackgroundThumbnailWorker();
    const llmWorker = createLlmWorker();
    const trimWorker = createTrimWorker();
    const trashWorker = createTrashWorker();
    const embedWorker = startEmbedWorker();
    const transcodeWorker = createTranscodeWorker();
    const backgroundTranscodeWorker = createBackgroundTranscodeWorker();

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down workers...');
        await Promise.all([
            ocrWorker.close(),
            backgroundOcrWorker.close(),
            thumbnailWorker.close(),
            backgroundThumbnailWorker.close(),
            llmWorker.close(),
            trimWorker.close(),
            trashWorker.close(),
            embedWorker?.close(),
            transcodeWorker.close(),
            backgroundTranscodeWorker.close(),
        ]);
        logger.info('All workers stopped');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('All workers started');

    return { ocrWorker, thumbnailWorker, llmWorker };
}

// Run all workers if executed directly
if (require.main === module) {
    // Load environment
    require('dotenv').config({ path: '../../.env' });
    startAllWorkers();
}
