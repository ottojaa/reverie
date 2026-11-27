import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', async () => {
    const { join } = await import('node:path');

    return {
        env: {
            PYTHON_PATH: join(__dirname, '../testing/fake-ocr-runner.mjs'),
            OCR_DEVICE: 'cpu',
            OCR_BACKGROUND_DOC_UNWARPING: false,
            OCR_BACKGROUND_DOC_ORIENTATION: true,
            OCR_BACKGROUND_DET_MAX_SIDE: 1920,
        },
    };
});

// Starting the client kills leftover runners by path; a test must not touch processes on this machine.
vi.mock('child_process', async (importOriginal) => ({ ...(await importOriginal<typeof import('child_process')>()), execFileSync: vi.fn() }));

import { recognizeFromFilePath, recognizeText, shutdownPaddleOcr, startPaddleOcr } from './paddleocr.client';

/** The request the fake runner answered. */
const sentBy = async (output: Promise<{ text: string }>) => JSON.parse((await output).text) as Record<string, unknown>;

const BACKGROUND_SETTINGS = {
    use_doc_unwarping: false,
    use_doc_orientation_classify: true,
    text_det_limit_side_len: 1920,
    text_det_limit_type: 'max',
};

describe('PaddleOCR client', () => {
    beforeAll(startPaddleOcr);
    afterEach(() => vi.useRealTimers());
    afterAll(shutdownPaddleOcr);

    it('gives a request its own answer after an earlier one timed out', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const abandoned = expect(recognizeFromFilePath('/slow.png')).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(60_000);
        await abandoned;
        vi.useRealTimers();

        expect(await sentBy(recognizeFromFilePath('/next.png'))).toMatchObject({ image_path: '/next.png' });
    });

    it('sends PaddleOCR settings with a background request only', async () => {
        expect(await sentBy(recognizeFromFilePath('/scan.pdf', 'background'))).toMatchObject({ settings: BACKGROUND_SETTINGS });
        expect(await sentBy(recognizeText(Buffer.from('image'), 'background'))).toMatchObject({ settings: BACKGROUND_SETTINGS });
        expect(await sentBy(recognizeText(Buffer.from('image')))).not.toHaveProperty('settings');
        expect(await sentBy(recognizeFromFilePath('/photo.png', 'normal'))).not.toHaveProperty('settings');
    });

    it("rejects a request with the runner's error", async () => {
        await expect(recognizeFromFilePath('/broken.png')).rejects.toThrow('PaddleOCR error: broken image');
    });

    it('says why the runner could not start', async () => {
        await shutdownPaddleOcr();
        vi.stubEnv('FAKE_OCR_STARTUP_ERROR', 'no models');

        await expect(startPaddleOcr()).rejects.toThrow('PaddleOCR startup failed: no models');

        vi.unstubAllEnvs();
    });
});
