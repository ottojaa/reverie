import type { LockSecret } from '@reverie/shared';
import bcrypt from 'bcrypt';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { createApiToken } from '../services/api-token.service.js';
import { hashPassword } from '../services/auth.service.js';
import { ACCOUNT_PASSWORD, fetchLockRow, LOCK_PASSWORD, LockSession, PIN, resetLock, setWrongTries, startLockApp, type LockApp } from '../testing/lock-app.js';
import { describeDb, useWorld } from '../testing/tool-world.js';

const NEW_PIN: LockSecret = { kind: 'pin', value: '7350' };

const WRONG_ACCOUNT_BODY = {
    statusCode: 403,
    error: 'invalid_credentials',
    message: 'Incorrect account password',
    details: { ask: 'account_password', tries_left: null },
};

describeDb('saving a lock secret', () => {
    const ctx = useWorld();
    let lock: LockApp;
    let accountHash: string;

    const db = () => ctx.world().db;
    const userId = () => ctx.world().alice;
    const folder = () => ctx.world().folders.lockedFolder.id;
    const newSession = () => new LockSession(lock.app, userId());
    const row = () => fetchLockRow(db(), userId());

    /** Runs `meanwhile` while the server is comparing `typed`, then lets the comparison answer. */
    function duringCompare(typed: string, meanwhile: () => Promise<unknown>): void {
        const compare = bcrypt.compare.bind(bcrypt) as (value: string, hash: string) => Promise<boolean>;
        let isDone = false;

        vi.spyOn(bcrypt, 'compare').mockImplementation((async (value: string, hash: string) => {
            if (value !== typed || isDone) return compare(value, hash);

            isDone = true;
            await meanwhile();

            return compare(value, hash);
        }) as never);
    }

    beforeAll(async () => {
        lock = await startLockApp();
        accountHash = await hashPassword(ACCOUNT_PASSWORD);
    }, 60_000);
    beforeEach(() => resetLock(db(), userId(), accountHash));
    afterEach(() => vi.restoreAllMocks());
    afterAll(() => lock.app.close());

    describe.each<{ change: string; from: LockSecret | null; isStopped?: boolean; to: LockSecret | null }>([
        { change: 'set', from: null, to: PIN },
        { change: 'change', from: PIN, to: NEW_PIN },
        { change: 'switch kind', from: PIN, to: LOCK_PASSWORD },
        { change: 'reset a stopped one', from: PIN, isStopped: true, to: NEW_PIN },
        { change: 'remove', from: LOCK_PASSWORD, to: null },
    ])('$change', ({ from, isStopped, to }) => {
        async function arrange(): Promise<LockSession> {
            const session = newSession();

            if (from) await session.save(from);

            if (isStopped) await setWrongTries(db(), userId(), 10);

            return session;
        }

        it('needs the account password, and the old lock secret is not proof', async () => {
            const session = await arrange();
            const before = await row();

            for (const proof of ['not the account password', from?.value ?? 'x']) {
                const refused = await session.save(to, proof);

                expect([refused.status, refused.body]).toEqual([403, WRONG_ACCOUNT_BODY]);
                expect(refused.cookieSet).toBe(false);
            }

            expect(await row()).toEqual(before);
        });

        it('is saved with it, with the count started over', async () => {
            const session = await arrange();
            const generation = (await row())?.generation ?? 0;
            const saved = await session.save(to);

            expect(saved.status).toBe(200);
            expect(saved.body).toEqual({ unlocked: false, has_password: true, secret_kind: to?.kind ?? null, ask: to?.kind ?? 'account_password' });
            expect(await row()).toMatchObject({ kind: to?.kind ?? null, wrong_tries: 0, generation: generation + 1 });
            expect((await newSession().unlock(folder(), to?.value ?? ACCOUNT_PASSWORD)).status).toBe(200);

            if (from && to) expect((await newSession().unlock(folder(), from.value)).status).toBe(403);
        });
    });

    describe('what is accepted', () => {
        const send = (secret: unknown) => newSession().request('PUT', '/vault/secret', { payload: { account_password: ACCOUNT_PASSWORD, secret } });

        it.each([
            { kind: 'pin', value: '123' },
            { kind: 'pin', value: '12345' },
            { kind: 'pin', value: '12a4' },
            { kind: 'pin', value: ' 1234' },
            { kind: 'password', value: 'abc' },
            { kind: 'password', value: 'z'.repeat(129) },
            { kind: 'pattern', value: '1234' },
            undefined,
        ])('refuses %j', async (secret) => {
            const refused = await send(secret);

            expect(refused.status).toBe(400);
            expect(refused.body.error).toBe('VALIDATION_ERROR');
            expect(refused.raw).not.toContain(ACCOUNT_PASSWORD);

            if (secret) expect(refused.raw).not.toContain('"' + secret.value + '"');

            expect(await row()).toBeUndefined();
        });

        it.each([
            { kind: 'pin', value: '0000' },
            { kind: 'password', value: 'abcd' },
            { kind: 'password', value: 'z'.repeat(128) },
        ])('takes %j', async (secret) => {
            expect((await send(secret)).status).toBe(200);
        });
    });

    describe('open locks across sessions', () => {
        it('closes every other session’s and keeps the saver’s, at each save', async () => {
            const saver = newSession();
            const other = newSession();

            await saver.unlock(folder(), ACCOUNT_PASSWORD);
            await other.unlock(folder(), ACCOUNT_PASSWORD);

            const saved = await saver.save(PIN);

            expect(saved.body.unlocked).toBe(true);
            expect(await saver.canOpen(folder())).toBe(true);
            expect(await other.canOpen(folder())).toBe(false);
            expect((await other.status()).unlocked).toBe(false);

            expect((await other.unlock(folder(), PIN.value)).status).toBe(200);
            await saver.save(null);

            expect(await saver.canOpen(folder())).toBe(true);
            expect(await other.canOpen(folder())).toBe(false);
        });

        it('keeps what a cookie from before generations had open, until the first save', async () => {
            const old = newSession();

            old.cookie = lock.app.jwt.sign({ sub: userId(), scope: 'vault', locks: [folder()] } as never);

            expect(await old.canOpen(folder())).toBe(true);

            await newSession().save(PIN);

            expect(await old.canOpen(folder())).toBe(false);
        });

        it('does not carry locks of a past generation into the next unlock', async () => {
            const { vault } = ctx.world().folders;
            const stale = newSession();

            await stale.unlock(vault.id, ACCOUNT_PASSWORD);
            await newSession().save(PIN);
            await stale.unlock(folder(), PIN.value);

            expect(await stale.canOpen(folder())).toBe(true);
            expect(await stale.canOpen(vault.id)).toBe(false);
        });

        it('does not let a lock opened with the old secret outlive a save made meanwhile', async () => {
            const opener = newSession();

            await newSession().save(PIN);
            duringCompare(PIN.value, async () => {
                await newSession().save(NEW_PIN);
                await setWrongTries(db(), userId(), 5);
            });
            await opener.unlock(folder(), PIN.value);

            expect(await opener.canOpen(folder())).toBe(false);
            // The try the old secret gives back is not taken off the new secret's count.
            expect((await row())?.wrong_tries).toBe(5);
        });

        it('does not let a lock opened with the account password outlive a first save made meanwhile', async () => {
            const opener = newSession();

            duringCompare(ACCOUNT_PASSWORD, () => newSession().save(PIN));
            await opener.unlock(folder(), ACCOUNT_PASSWORD);

            expect(await opener.canOpen(folder())).toBe(false);
        });

        it('keeps nothing open for a saver another save overtook', async () => {
            const slow = newSession();

            await slow.unlock(folder(), ACCOUNT_PASSWORD);
            duringCompare(ACCOUNT_PASSWORD, () => newSession().save(NEW_PIN));

            const saved = await slow.save(PIN);

            expect(saved.body.unlocked).toBe(false);
            expect(await slow.canOpen(folder())).toBe(false);
        });
    });

    describe('who gets in', () => {
        const requests = (folderId: string) =>
            [
                ['GET', '/vault/status', undefined],
                ['POST', '/vault/unlock', { password: ACCOUNT_PASSWORD, folder_id: folderId }],
                ['PUT', '/vault/secret', { account_password: ACCOUNT_PASSWORD, secret: PIN }],
            ] as const;

        it.each(['an API token', 'the vault cookie’s token'])('turns away %s', async (bearer) => {
            const session = newSession();

            await session.unlock(folder(), ACCOUNT_PASSWORD);

            const token = bearer === 'an API token' ? (await createApiToken(userId(), 'test')).secret : session.cookie;

            for (const [method, url, payload] of requests(folder())) {
                const refused = await newSession().request(method, url, { payload, headers: { authorization: 'Bearer ' + token } });

                expect([url, refused.status, refused.body.error]).toEqual([url, 401, 'token_invalid']);
            }

            expect(await row()).toBeUndefined();
        });

        it('limits saves from one address', async () => {
            const session = newSession();
            const send = () => session.request('PUT', '/vault/secret', { payload: { account_password: 'x', secret: PIN }, address: '192.0.2.2' });

            for (let sent = 0; sent < 30; sent += 1) expect((await send()).status).toBe(403);

            expect((await send()).status).toBeGreaterThanOrEqual(429);
        }, 30_000);
    });

    describe('what is typed, the hash and the count', () => {
        const typed = ['7350', '9164', 'quiet-lantern-harbour', 'loud-lantern', ACCOUNT_PASSWORD, 'unquoted-lantern', '$2b$', 'wrong_tries'];

        /** The log without its clock readings, whose digits could pass for a PIN. */
        const loggedText = () => lock.logged.map((line) => JSON.stringify({ ...JSON.parse(line), time: 0, responseTime: 0 })).join('\n');

        it('stay out of every answer and every log line', async () => {
            const session = newSession();

            lock.logged.length = 0;

            const answers = [
                await session.save(NEW_PIN),
                await session.unlock(folder(), '9164'),
                await session.unlock(folder(), NEW_PIN.value),
                await session.save(LOCK_PASSWORD),
                await session.unlock(folder(), 'loud-lantern'),
                await session.unlock(folder(), LOCK_PASSWORD.value),
                await session.save(NEW_PIN, 'loud-lantern'),
            ];

            for (const text of [...answers.map((answer) => answer.raw), loggedText()]) {
                for (const value of typed) expect(text).not.toContain(value);
            }

            expect(lock.logged.length).toBeGreaterThan(0);
        });

        it.each(['/vault/unlock', '/vault/secret'])('stay out of the log when the body sent to %s is not JSON', async (url) => {
            lock.logged.length = 0;

            const refused = await newSession().request(url === '/vault/unlock' ? 'POST' : 'PUT', url, {
                payload: '{"password": unquoted-lantern}',
                headers: { 'content-type': 'application/json' },
            });

            expect(refused.status).toBe(400);
            expect(refused.body).toEqual({ error: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' });
            expect(loggedText()).not.toContain('unquoted');
            expect(loggedText()).not.toContain('lantern');
        });
    });
});
