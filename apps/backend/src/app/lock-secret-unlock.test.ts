import bcrypt from 'bcrypt';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));
vi.mock('../queues/llm.queue', () => ({ addLlmJob: vi.fn() }));
vi.mock('../queues/ocr.queue', () => ({ addOcrJob: vi.fn() }));
vi.mock('../queues/trim.queue', () => ({ addTrimJob: vi.fn() }));

import { hashPassword } from '../services/auth.service.js';
import {
    ACCOUNT_PASSWORD,
    fetchLockRow,
    LOCK_PASSWORD,
    LockSession,
    PIN,
    resetLock,
    setWrongTries,
    startLockApp,
    STOPPED_BODY,
    type LockApp,
} from '../testing/lock-app.js';
import { describeDb, useWorld } from '../testing/tool-world.js';

describeDb('opening a folder lock', () => {
    const ctx = useWorld();
    let lock: LockApp;
    let accountHash: string;

    const db = () => ctx.world().db;
    const userId = () => ctx.world().alice;
    const folder = () => ctx.world().folders.lockedFolder.id;
    const publicFolder = () => ctx.world().folders.work.id;
    const newSession = () => new LockSession(lock.app, userId());
    const wrongTries = async () => (await fetchLockRow(db(), userId()))?.wrong_tries;

    /** A session of a user who has set this lock secret. The session itself has nothing open. */
    async function withSecret(secret = PIN): Promise<LockSession> {
        await newSession().save(secret);

        return newSession();
    }

    beforeAll(async () => {
        lock = await startLockApp();
        accountHash = await hashPassword(ACCOUNT_PASSWORD);
    }, 60_000);
    beforeEach(() => resetLock(db(), userId(), accountHash));
    afterEach(() => vi.restoreAllMocks());
    afterAll(() => lock.app.close());

    describe('with no lock secret set', () => {
        it('says the account password opens', async () => {
            expect(await newSession().status()).toEqual({ unlocked: false, has_password: true, secret_kind: null, ask: 'account_password' });
        });

        it('opens with the account password', async () => {
            const session = newSession();
            const opened = await session.unlock(folder(), ACCOUNT_PASSWORD);

            expect(opened.status).toBe(200);
            expect(opened.body).toEqual({ unlocked: true, has_password: true, secret_kind: null, ask: 'account_password' });
            expect(await session.canOpen(folder())).toBe(true);
        });

        it('answers a wrong password byte for byte as before, and counts nothing', async () => {
            const session = newSession();
            const refused = await session.unlock(folder(), 'nope');

            expect(refused.status).toBe(401);
            expect(refused.raw).toBe('{"error":"invalid_credentials","message":"Incorrect password"}');
            expect(refused.cookieSet).toBe(false);
            expect(await fetchLockRow(db(), userId())).toBeUndefined();
        });

        it('checks the password before it looks for the folder’s lock, as before', async () => {
            const session = newSession();

            expect((await session.unlock(publicFolder(), 'nope')).status).toBe(401);

            const missing = await session.unlock(publicFolder(), ACCOUNT_PASSWORD);

            expect(missing.status).toBe(404);
            expect(missing.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND' });
            expect(missing.cookieSet).toBe(false);
        });

        it('leaves an account without a password as it was: nothing locked, nothing to set', async () => {
            await db().updateTable('users').set({ password_hash: null, google_id: 'google-1' }).where('id', '=', userId()).execute();

            const session = newSession();
            const noPassword = '{"error":"no_password","message":"Set an account password to unlock private folders"}';
            const unlock = await session.unlock(folder(), 'anything');
            const save = await session.save(PIN, 'anything');

            expect(await session.status()).toEqual({ unlocked: false, has_password: false, secret_kind: null, ask: null });
            expect([unlock.status, unlock.raw]).toEqual([400, noPassword]);
            expect([save.status, save.raw]).toEqual([400, noPassword]);
            expect(await session.canOpen(folder())).toBe(true);
            expect(await fetchLockRow(db(), userId())).toBeUndefined();
        });
    });

    describe.each([
        { secret: PIN, name: 'PIN', wrong: '0000' },
        { secret: LOCK_PASSWORD, name: 'password', wrong: 'loud-lantern' },
    ])('with a lock $name set', ({ secret, name, wrong }) => {
        const refusalBody = (triesLeft: number) => ({
            statusCode: 403,
            error: 'invalid_credentials',
            message: `Incorrect ${name}. Tries left: ${triesLeft}`,
            details: { ask: secret.kind, tries_left: triesLeft },
        });

        it('opens with it and gives the try back', async () => {
            const session = await withSecret(secret);

            await setWrongTries(db(), userId(), 3);

            const opened = await session.unlock(folder(), secret.value);

            expect(opened.status).toBe(200);
            expect(opened.body).toEqual({ unlocked: true, has_password: true, secret_kind: secret.kind, ask: secret.kind });
            expect(await session.canOpen(folder())).toBe(true);
            expect(await wrongTries()).toBe(3);
        });

        it('refuses a wrong one with a 403 that counts down', async () => {
            const session = await withSecret(secret);
            const first = await session.unlock(folder(), wrong);
            const second = await session.unlock(folder(), wrong);

            expect([first.status, first.body]).toEqual([403, refusalBody(9)]);
            expect([second.status, second.body]).toEqual([403, refusalBody(8)]);
            expect(second.cookieSet).toBe(false);
            expect(await wrongTries()).toBe(2);
        });

        it('does not take the account password in its place, and counts that as a try', async () => {
            const session = await withSecret(secret);
            const refused = await session.unlock(folder(), ACCOUNT_PASSWORD);

            expect([refused.status, refused.body]).toEqual([403, refusalBody(9)]);
            expect(await session.canOpen(folder())).toBe(false);
        });

        it('stops after ten wrong tries, however many right ones come between them', async () => {
            const session = await withSecret(secret);

            for (let left = 9; left >= 1; left -= 1) {
                expect((await session.unlock(folder(), wrong)).body).toEqual(refusalBody(left));
                expect((await session.unlock(folder(), secret.value)).status).toBe(200);
            }

            const last = await session.unlock(folder(), wrong);
            const right = await session.unlock(folder(), secret.value);

            expect([last.status, last.body]).toEqual([403, STOPPED_BODY]);
            expect([right.status, right.body]).toEqual([403, STOPPED_BODY]);
            expect(await wrongTries()).toBe(10);
        }, 30_000);

        it('once stopped, takes only the account password, which starts the count over', async () => {
            const session = await withSecret(secret);

            await setWrongTries(db(), userId(), 10);

            expect(await session.status()).toEqual({ unlocked: false, has_password: true, secret_kind: secret.kind, ask: 'account_password' });

            for (const typed of [secret.value, wrong, 'not the account password']) {
                const refused = await session.unlock(folder(), typed);

                expect([refused.status, refused.body]).toEqual([403, STOPPED_BODY]);
            }

            expect(await wrongTries()).toBe(10);

            const opened = await session.unlock(folder(), ACCOUNT_PASSWORD);

            expect(opened.body).toEqual({ unlocked: true, has_password: true, secret_kind: secret.kind, ask: secret.kind });
            expect(await session.canOpen(folder())).toBe(true);
            expect(await wrongTries()).toBe(0);
            expect((await newSession().unlock(folder(), secret.value)).status).toBe(200);
        });

        it('spends no try on a folder that is not private', async () => {
            const session = await withSecret(secret);
            const compare = vi.spyOn(bcrypt, 'compare');

            for (const typed of [wrong, secret.value]) {
                expect((await session.unlock(publicFolder(), typed)).status).toBe(404);
            }

            expect(compare).not.toHaveBeenCalled();
            expect(await wrongTries()).toBe(0);
        });
    });

    it('compares no more of 100 guesses sent at once than there are tries left', async () => {
        const session = await withSecret();

        await setWrongTries(db(), userId(), 4);

        const secretHash = (await fetchLockRow(db(), userId()))?.secret_hash;
        const compare = vi.spyOn(bcrypt, 'compare');
        const guesses = Array.from({ length: 100 }, (_, index) => String(index).padStart(4, '0'));
        const answers = await Promise.all(guesses.map((guess) => session.unlock(folder(), guess)));
        const triesLeft = answers.map((answer) => answer.body.details.tries_left).filter((left) => left !== null);

        expect(answers.map((answer) => answer.status)).toEqual(Array(100).fill(403));
        expect(compare.mock.calls.filter(([, hash]) => hash === secretHash)).toHaveLength(6);
        expect(triesLeft.sort()).toEqual([1, 2, 3, 4, 5]);
        expect(await wrongTries()).toBe(10);
    }, 60_000);

    it('limits unlock requests from one address, whatever is typed', async () => {
        const session = newSession();
        const send = () => session.request('POST', '/vault/unlock', { payload: { password: 'x', folder_id: publicFolder() }, address: '192.0.2.1' });

        for (let sent = 0; sent < 30; sent += 1) expect((await send()).status).toBe(401);

        // The limiter's 429, or the 500 the app's error handler makes of it.
        expect((await send()).status).toBeGreaterThanOrEqual(429);
    }, 30_000);
});
