export { createOcrWorker } from './ocr.worker';
export { createThumbnailWorker } from './thumbnail.worker';
export { createLlmWorker } from './llm.worker';
export { createTrimWorker } from './trim.worker';
export * from './worker.utils';

import { createOcrWorker } from './ocr.worker';
import { createThumbnailWorker } from './thumbnail.worker';
import { createLlmWorker } from './llm.worker';
import { createTrimWorker } from './trim.worker';
import { createWorkerLogger } from './worker.utils';

const logger = createWorkerLogger('WorkerManager');

/**
 * Start all workers in a single process
 * Use this for development or simple deployments
 */
export function startAllWorkers() {
    logger.info('Starting all workers...');

    const ocrWorker = createOcrWorker();
    const thumbnailWorker = createThumbnailWorker();
    const llmWorker = createLlmWorker();
    const trimWorker = createTrimWorker();

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down workers...');
        await Promise.all([ocrWorker.close(), thumbnailWorker.close(), llmWorker.close(), trimWorker.close()]);
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
