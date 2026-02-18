/**
 * PaddleOCR Client
 *
 * Manages a persistent PaddleOCR Python child process.
 * Models are loaded once on first use; subsequent calls reuse the warm process.
 * Communicates via newline-delimited JSON over stdin/stdout.
 */

import { type ChildProcess, spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { env } from '../config/env.js';
import type { OcrOutput } from './types';

/** Python executable */
const PYTHON_BIN = env.PYTHON_PATH;

/** Path to the Python OCR runner script */
const OCR_RUNNER_PATH = join(process.cwd(), 'apps/backend/ocr_service/ocr_runner.py');

/** How long to wait for the process to become ready (model loading) */
const STARTUP_TIMEOUT_MS = 120_000;

/** How long to wait for a single OCR request */
const REQUEST_TIMEOUT_MS = 60_000;

// ── Persistent process state ────────────────────────────────────

let childProcess: ChildProcess | null = null;
let readline: ReadlineInterface | null = null;
let ready = false;
let startingUp: Promise<void> | null = null;
let sharedTempDirPromise: Promise<string> | null = null;

/** Queue of pending response handlers (FIFO — one response per request) */
const pendingResponses: Array<{
    resolve: (value: PaddleOcrResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}> = [];

type PaddleOcrResponse =
    | { ready: true }
    | { pong: true }
    | { error: string }
    | PaddleOcrResult;

/** Shape of a successful OCR result from ocr_runner.py */
interface PaddleOcrResult {
    text: string;
    confidence: number;
    blocks: Array<{
        text: string;
        confidence: number;
        bbox: number[][];
    }>;
    engine?: string;
}

// ── Process lifecycle ───────────────────────────────────────────

function spawnProcess(): void {
    childProcess = spawn(PYTHON_BIN, [OCR_RUNNER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
        },
    });

    readline = createInterface({ input: childProcess.stdout! });

    // Every line from stdout is a JSON response
    readline.on('line', (line: string) => {
        let parsed: PaddleOcrResponse;

        try {
            parsed = JSON.parse(line) as PaddleOcrResponse;
        } catch {
            console.error('[PaddleOCR] Unparseable stdout line:', line);

            return;
        }

        // Resolve the oldest pending request
        const pending = pendingResponses.shift();

        if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(parsed);
        }
    });

    // Log stderr but don't kill the process — PaddleOCR is noisy
    childProcess.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();

        if (msg) {
            console.error('[PaddleOCR stderr]', msg);
        }
    });

    childProcess.on('exit', (code, signal) => {
        console.error(`[PaddleOCR] Process exited (code=${code}, signal=${signal})`);
        cleanup();

        // Reject all pending requests
        for (const pending of pendingResponses.splice(0)) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`PaddleOCR process exited unexpectedly (code=${code})`));
        }
    });
}

function cleanup(): void {
    readline?.close();
    readline = null;
    childProcess = null;
    ready = false;
    startingUp = null;
}

async function getSharedTempDir(): Promise<string> {
    if (!sharedTempDirPromise) {
        sharedTempDirPromise = mkdtemp(join(tmpdir(), 'reverie-ocr-'));
    }

    return sharedTempDirPromise;
}

/**
 * Ensure the persistent process is running and models are loaded.
 * Safe to call multiple times — concurrent callers share the same startup promise.
 */
async function ensureReady(): Promise<void> {
    if (ready && childProcess && !childProcess.killed) return;

    if (startingUp) return startingUp;

    startingUp = (async () => {
        spawnProcess();

        // Wait for the {"ready": true} message
        const response = await sendRaw(STARTUP_TIMEOUT_MS);

        if ('error' in response) {
            throw new Error(`PaddleOCR startup failed: ${response.error}`);
        }

        if (!('ready' in response)) {
            throw new Error(`Unexpected startup response: ${JSON.stringify(response)}`);
        }

        ready = true;
    })();

    return startingUp;
}

/**
 * Send a raw line and wait for the next JSON response.
 */
function sendRaw(timeoutMs: number, message?: string): Promise<PaddleOcrResponse> {
    return new Promise<PaddleOcrResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
            // Remove from queue
            const idx = pendingResponses.findIndex((p) => p.resolve === resolve);

            if (idx !== -1) pendingResponses.splice(idx, 1);

            reject(new Error(`PaddleOCR request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingResponses.push({ resolve, reject, timer });

        if (message !== undefined) {
            childProcess!.stdin!.write(message + '\n');
        }
    });
}

/**
 * Send a JSON request and wait for the response.
 */
async function sendRequest(request: Record<string, unknown>): Promise<PaddleOcrResponse> {
    await ensureReady();

    return sendRaw(REQUEST_TIMEOUT_MS, JSON.stringify(request));
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Eagerly start the PaddleOCR process and load models.
 * Call at app startup so the first OCR request doesn't pay the cold-start cost.
 */
export async function startPaddleOcr(): Promise<void> {
    await ensureReady();
    console.log('[PaddleOCR] Process started and models loaded');
}

/**
 * Recognize text in an image buffer using PaddleOCR
 */
export async function recognizeText(imageBuffer: Buffer): Promise<OcrOutput> {
    let tempImagePath: string | null = null;

    try {
        // Write buffer to a temp file (PaddleOCR needs a file path).
        // Reuse a shared temp directory to avoid mkdir/rm overhead per request.
        const tempDir = await getSharedTempDir();
        tempImagePath = join(tempDir, `input-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        await writeFile(tempImagePath, imageBuffer);

        const response = await sendRequest({ image_path: tempImagePath });

        if ('error' in response) {
            throw new Error(`PaddleOCR error: ${response.error}`);
        }

        const result = response as PaddleOcrResult;

        return {
            text: result.text ?? '',
            confidence: result.confidence ?? 0,
            engine: result.engine ?? 'paddleocr/PP-OCRv3',
        };
    } finally {
        if (tempImagePath) {
            await rm(tempImagePath, { force: true }).catch(() => {
                /* ignore cleanup errors */
            });
        }
    }
}

/**
 * Check if PaddleOCR is available (Python + paddleocr installed)
 */
export async function isPaddleOcrAvailable(): Promise<boolean> {
    try {
        await ensureReady();
        const response = await sendRequest({ ping: true });

        return 'pong' in response;
    } catch {
        return false;
    }
}

/**
 * Gracefully shut down the persistent Python process.
 * Call this on server shutdown.
 */
export async function shutdownPaddleOcr(): Promise<void> {
    if (!childProcess || childProcess.killed) return;

    childProcess.stdin?.end();
    childProcess.kill('SIGTERM');

    // Give it a moment to exit gracefully
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            childProcess?.kill('SIGKILL');
            resolve();
        }, 5_000);

        childProcess?.on('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });

    cleanup();

    if (sharedTempDirPromise) {
        const tempDir = await sharedTempDirPromise.catch(() => null);
        sharedTempDirPromise = null;

        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {
                /* ignore cleanup errors */
            });
        }
    }
}

process.on('SIGINT', shutdownPaddleOcr);
process.on('SIGTERM', shutdownPaddleOcr);
process.on('SIGQUIT', shutdownPaddleOcr);
process.on('exit', shutdownPaddleOcr);
