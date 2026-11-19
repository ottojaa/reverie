import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadEnv() {
    vi.resetModules();

    return (await import('./env.js')).env;
}

describe('TRASH_RETENTION_DAYS', () => {
    beforeEach(() => {
        // A missing env file keeps the developer's own .env out of the test.
        vi.stubEnv('ENV_FILE', '.env.does-not-exist');
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test');
        vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
        vi.stubEnv('FILE_URL_SECRET', 'y'.repeat(32));
        vi.stubEnv('TRASH_RETENTION_DAYS', '');
        delete process.env.TRASH_RETENTION_DAYS;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to 30 days when unset', async () => {
        expect((await loadEnv()).TRASH_RETENTION_DAYS).toBe(30);
    });

    it('takes the value from the environment', async () => {
        vi.stubEnv('TRASH_RETENTION_DAYS', '45');

        expect((await loadEnv()).TRASH_RETENTION_DAYS).toBe(45);
    });
});
