import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Starts the production build the way the container does (`node dist/main.js`, NODE_ENV=production) and
 * waits for it to listen. It catches any module that throws while the server starts, which unit tests
 * cannot see. It runs against the workspace's `node_modules`, so it cannot see a missing production
 * dependency (the vitest crash): that case is covered by the "no test files in dist" check below, the
 * guard in `app/routes-autoload.test.ts` and autoload's ignore pattern.
 *
 * The `test` target builds the backend first (project.json). Postgres and Redis are deliberately not
 * running: the server must still come up, and answer `degraded`, without them.
 */

const DIST = join(__dirname, '../dist');
const MAIN = join(DIST, 'main.js');
const BOOT_TIMEOUT_MS = 30_000;

function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);

        return entry.isDirectory() ? listFiles(path) : [path];
    });
}

function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();

        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const port = typeof address === 'object' && address ? address.port : 0;

            probe.close(() => resolve(port));
        });
    });
}

function assertBuilt(): void {
    if (existsSync(MAIN)) return;

    throw new Error('apps/backend/dist/main.js is missing: run `nx build backend` (the nx test target does) before this test');
}

describe('production build', () => {
    it('contains no test files', () => {
        assertBuilt();

        const offenders = listFiles(DIST).filter((file) => /\.(?:test|spec)\.[cm]?js$/.test(file));

        expect(offenders).toEqual([]);
    });

    it(
        'starts and listens',
        async () => {
            assertBuilt();

            const port = await findFreePort();
            const uploads = mkdtempSync(join(tmpdir(), 'boot-smoke-'));
            const child = spawn(process.execPath, [MAIN], {
                cwd: join(__dirname, '../../..'),
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: 'production',
                    HOST: '127.0.0.1',
                    PORT: String(port),
                    DATABASE_URL: 'postgres://smoke:smoke@127.0.0.1:1/smoke',
                    REDIS_URL: 'redis://127.0.0.1:1',
                    JWT_SECRET: 'smoke-test-jwt-secret-0123456789abcdef',
                    FILE_URL_SECRET: 'smoke-test-file-url-secret-0123456789',
                    STORAGE_LOCAL_ROOT: uploads,
                    WS_ENABLED: 'false',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            const listening = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Server did not start in time: ' + output.slice(-2000))), BOOT_TIMEOUT_MS);

                const onData = (chunk: Buffer) => {
                    output += chunk.toString();

                    if (!output.includes('Server listening')) return;

                    clearTimeout(timer);
                    resolve();
                };

                child.stdout.on('data', onData);
                child.stderr.on('data', onData);
                child.once('exit', (code) => {
                    clearTimeout(timer);
                    reject(new Error('Server exited while starting, code ' + code + ': ' + output.slice(-2000)));
                });
            });

            try {
                await listening;

                const health = await fetch(`http://127.0.0.1:${port}/health`);
                const protectedRoute = await fetch(`http://127.0.0.1:${port}/documents`);

                expect(health.status).toBeLessThan(600);
                expect(await health.json()).toMatchObject({ status: 'degraded' });
                expect(protectedRoute.status).toBe(401);
            } finally {
                child.removeAllListeners('exit');
                child.kill('SIGKILL');
                rmSync(uploads, { recursive: true, force: true });
            }
        },
        BOOT_TIMEOUT_MS + 10_000,
    );
});
