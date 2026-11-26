import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * What a test needs to run the real upload service: local storage in a throwaway directory, and
 * stand-ins for the modules that would open Redis, which only record the jobs queued.
 */

export const storageRoot = mkdtempSync(join(tmpdir(), 'reverie-upload-test-'));

export const testEnv = {
    NODE_ENV: 'test',
    JWT_SECRET: 's'.repeat(32),
    JWT_ACCESS_EXPIRES: '15m',
    STORAGE_PROVIDER: 'local',
    STORAGE_LOCAL_ROOT: storageRoot,
    API_PUBLIC_URL: undefined as string | undefined,
};

export const queued: { ocr: string[]; thumbnail: string[] } = { ocr: [], thumbnail: [] };

export const ocrQueueStub = {
    addOcrJob: async (data: { documentId: string }) => void queued.ocr.push(data.documentId),
};

export const thumbnailQueueStub = {
    addThumbnailJob: async (data: { documentId: string }) => void queued.thumbnail.push(data.documentId),
};
