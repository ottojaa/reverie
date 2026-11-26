import pg from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({
    env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 },
}));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { ACCOUNT_PASSWORD, LockSession, PIN, resetLock, startLockApp, type LockApp } from '../testing/lock-app.js';
import { describeDb, useWorld } from '../testing/tool-world.js';

describeDb('what a vault request reads', () => {
    const ctx = useWorld();
    let lock: LockApp;
    let session: LockSession;
    let queries: MockInstance;

    beforeAll(async () => {
        lock = await startLockApp();
    }, 60_000);
    beforeEach(async () => {
        await resetLock(ctx.world().db, ctx.world().alice);
        session = new LockSession(lock.app, ctx.world().alice);
        queries = vi.spyOn(pg.Client.prototype, 'query');
    });
    afterAll(() => lock.app.close());

    /** How many queries a request that succeeds makes. */
    async function countQueries(send: () => Promise<{ status: number }>): Promise<number> {
        queries.mockClear();
        expect((await send()).status).toBe(200);

        return queries.mock.calls.length;
    }

    const unlock = (secret: string) => () => session.unlock(ctx.world().folders.lockedFolder.id, secret);

    it('is no more than it needs for an unlock, a status and a save', async () => {
        // An unlock and a save read the lock map once and the lock state before and after; the other two queries
        // check or write the secret. A status reads the map and the state.
        expect(await countQueries(unlock(ACCOUNT_PASSWORD))).toBe(5);
        expect(await countQueries(() => session.request('GET', '/vault/status'))).toBe(2);
        expect(await countQueries(() => session.save(PIN))).toBe(5);
        expect(await countQueries(unlock(PIN.value))).toBe(5);
    }, 30_000);
});
