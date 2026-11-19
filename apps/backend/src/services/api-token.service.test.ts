import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { sql } from 'kysely';
import { dbProxy } from '../testing/db-proxy.js';
import { seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { createApiToken, hashToken, listApiTokens, revokeApiToken, TOKEN_SECRET_PREFIX, verifyApiToken } from './api-token.service.js';

describeDb('api token service', () => {
    let database: TestDatabase;
    let userId: string;

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        userId = await seedUser(database.db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const lastUsed = async (id: string) =>
        (await database.db.selectFrom('api_tokens').select('last_used_at').where('id', '=', id).executeTakeFirstOrThrow()).last_used_at;

    it('stores only the hash of a secret that carries the Reverie prefix', async () => {
        const { token, secret } = await createApiToken(userId, 'laptop');

        expect(secret.startsWith(TOKEN_SECRET_PREFIX)).toBe(true);
        expect(secret.length).toBeGreaterThan(40);
        expect(token.token_hash).toBe(hashToken(secret));
        expect(JSON.stringify(token)).not.toContain(secret);
        expect(secret.startsWith(token.token_prefix)).toBe(true);
        expect(token.token_prefix).not.toBe(secret);
    });

    it('verifies a secret to its user, and refuses anything else', async () => {
        const { secret } = await createApiToken(userId, 'checked');

        expect((await verifyApiToken(secret))?.user.id).toBe(userId);
        expect(await verifyApiToken(secret + 'x')).toBeNull();
        expect(await verifyApiToken(secret.replace(TOKEN_SECRET_PREFIX, ''))).toBeNull();
        expect(await verifyApiToken('')).toBeNull();
    });

    it('writes last_used_at once per minute, not on every request', async () => {
        const { token, secret } = await createApiToken(userId, 'throttled');

        await verifyApiToken(secret);

        const first = await lastUsed(token.id);

        expect(first).toBeInstanceOf(Date);
        await verifyApiToken(secret);
        expect(await lastUsed(token.id)).toEqual(first);

        await database.db
            .updateTable('api_tokens')
            .set({ last_used_at: sql<Date>`now() - interval '2 minutes'` })
            .where('id', '=', token.id)
            .execute();
        await verifyApiToken(secret);
        expect((await lastUsed(token.id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('fails the very next verification once revoked, and lists only live personal tokens', async () => {
        const mine = await createApiToken(userId, 'to-revoke');
        const agent = await createApiToken(userId, 'agent-run', { kind: 'agent', expiresAt: new Date(Date.now() + 60_000) });

        expect(await verifyApiToken(mine.secret)).not.toBeNull();
        expect(await revokeApiToken(userId, mine.token.id)).toBe(true);
        expect(await verifyApiToken(mine.secret)).toBeNull();
        expect(await revokeApiToken(userId, mine.token.id)).toBe(false);

        const listed = (await listApiTokens(userId)).map((token) => token.id);

        expect(listed).not.toContain(mine.token.id);
        expect(listed).not.toContain(agent.token.id);
        expect(await verifyApiToken(agent.secret)).not.toBeNull();
    });

    it('does not let one user revoke another’s token', async () => {
        const other = await seedUser(database.db, 'other');
        const { token, secret } = await createApiToken(userId, 'protected');

        expect(await revokeApiToken(other, token.id)).toBe(false);
        expect(await verifyApiToken(secret)).not.toBeNull();
    });
});
