import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFreePort } from './test-database';

/**
 * What a test of the real queues needs: a throwaway `redis-server` of its own (a running dev stack has queues of the
 * same names), and an environment the real `config/env` accepts. Await it in a `vi.mock` factory of `config/env`, before
 * importing the original. Without `redis-server` on PATH it throws: a silently skipped suite would let a regression through.
 */

export interface QueueEnv {
    storageRoot: string;
    stop: () => Promise<void>;
}

function waitUntilReady(server: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', (error) => reject(new Error('No redis-server for the queue tests: install Redis, or set SKIP_DB_TESTS=1: ' + error.message)));
        server.once('exit', (code) => reject(new Error('The test redis-server stopped while starting: ' + code)));
        server.stdout!.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('Ready to accept connections')) resolve();
        });
    });
}

async function startRedis(port: number, dir: string): Promise<ChildProcess> {
    const server = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', dir]);

    await waitUntilReady(server);

    return server;
}

function stopServer(server: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        server.once('exit', () => resolve());
        server.kill();
    });
}

export async function startQueueEnv(): Promise<QueueEnv> {
    const dir = mkdtempSync(join(tmpdir(), 'reverie-queue-test-'));

    // `SKIP_DB_TESTS=1` turns the suites that use this off, so there is no server to start. The config still loads.
    const skipped = process.env['SKIP_DB_TESTS'] === '1';
    const port = await findFreePort();
    const server = skipped ? null : await startRedis(port, dir);

    Object.assign(process.env, {
        // No env file: the developer's own settings must not reach the test.
        ENV_FILE: '.env.queue-test',
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
        REDIS_URL: `redis://127.0.0.1:${port}`,
        JWT_SECRET: 's'.repeat(32),
        FILE_URL_SECRET: 'f'.repeat(32),
        STORAGE_PROVIDER: 'local',
        STORAGE_LOCAL_ROOT: dir,
    });

    return {
        storageRoot: dir,
        stop: async () => {
            if (server) await stopServer(server);

            rmSync(dir, { recursive: true, force: true });
        },
    };
}
