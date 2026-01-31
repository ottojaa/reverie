import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import type { TesseractOutput } from './types';

/**
 * Tesseract OCR Client (Plan 05)
 *
 * Wrapper around tesseract.js for text extraction.
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
    // If already initialized, return existing instance
    if (workerInstance) {
        return workerInstance;
    }

    // If initialization is in progress, wait for it
    if (workerInitPromise) {
        return workerInitPromise;
    }

    // Start initialization
    workerInitPromise = (async () => {
        const worker = await createWorker('eng', OEM.DEFAULT, {
            // Logger can be enabled for debugging
            // logger: (m) => console.log(m),
        });

        // Configure for document processing
        await worker.setParameters({
            // Page segmentation mode: Assume single uniform block of text
            tessedit_pageseg_mode: PSM.AUTO,
            // Preserve interword spaces
            preserve_interword_spaces: '1',
        });

        workerInstance = worker;
        return worker;
    })();

    return workerInitPromise;
}

/**
 * Recognize text in an image buffer
 */
export async function recognizeText(imageBuffer: Buffer): Promise<TesseractOutput> {
    const worker = await initializeWorker();

    const result = await worker.recognize(imageBuffer);

    return {
        text: result.data.text,
        confidence: result.data.confidence,
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
