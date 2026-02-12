import { createWorker, OEM, PSM, Worker } from 'tesseract.js';
import type { OcrOutput } from './types';

/**
 * Tesseract OCR Client (Fallback)
 *
 * Wrapper around tesseract.js for text extraction.
 * Uses Finnish + English language models.
 * Manages worker lifecycle and provides simplified interface.
 */

/** Singleton worker instance (reused for efficiency) */
let workerInstance: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

/**
 * Initialize the Tesseract worker
 * Uses singleton pattern to avoid loading model multiple times
 */
async function initializeWorker(): Promise<Worker> {
    if (workerInstance) {
        return workerInstance;
    }

    if (workerInitPromise) {
        return workerInitPromise;
    }

    workerInitPromise = (async () => {
        // Load Finnish + English language models
        const worker = await createWorker('fin+eng', OEM.DEFAULT, {
            // Logger can be enabled for debugging
            // logger: (m) => console.log(m),
        });

        // Configure for document processing
        await worker.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            preserve_interword_spaces: '1',
        });

        workerInstance = worker;

        return worker;
    })();

    return workerInitPromise;
}

/**
 * Recognize text in an image buffer using Tesseract
 */
export async function recognizeText(imageBuffer: Buffer): Promise<OcrOutput> {
    const worker = await initializeWorker();
    const result = await worker.recognize(imageBuffer);

    return {
        text: result.data.text,
        confidence: result.data.confidence,
        engine: 'tesseract/5.x-fin+eng',
    };
}

/**
 * Terminate the Tesseract worker
 * Should be called when shutting down the application
 */
export async function terminateWorker(): Promise<void> {
    if (workerInstance) {
        await workerInstance.terminate();
        workerInstance = null;
        workerInitPromise = null;
    }
}

/**
 * Check if the worker is initialized
 */
export function isWorkerInitialized(): boolean {
    return workerInstance !== null;
}
