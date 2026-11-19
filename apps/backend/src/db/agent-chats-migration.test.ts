import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/015_agent_chats';

describeDb('migration 015 (agent_chats)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    async function tablesExist(): Promise<boolean> {
        const { rows } = await sql<{ found: boolean }>`
            SELECT to_regclass('public.agent_chats') IS NOT NULL AND to_regclass('public.agent_messages') IS NOT NULL AS found`.execute(database.db);

        return rows[0]!.found;
    }

    it('creates both tables, with a message list that starts empty', async () => {
        const userId = await seedUser(database.db, 'owner');
        const chat = await database.db.insertInto('agent_chats').values({ user_id: userId, title: 'Tidy invoices' }).returningAll().executeTakeFirstOrThrow();
        const message = await database.db
            .insertInto('agent_messages')
            .values({ chat_id: chat.id, role: 'user', items: JSON.stringify([{ type: 'text', text: 'hi' }]) })
            .returningAll()
            .executeTakeFirstOrThrow();

        expect(await tablesExist()).toBe(true);
        expect(chat).toMatchObject({ claude_session_id: null });
        expect(message).toMatchObject({ error: null, items: [{ type: 'text', text: 'hi' }] });
    });

    it('removes chats and their messages with the user', async () => {
        const userId = await seedUser(database.db, 'leaver');
        const chat = await database.db.insertInto('agent_chats').values({ user_id: userId, title: 'x' }).returning('id').executeTakeFirstOrThrow();

        await database.db.insertInto('agent_messages').values({ chat_id: chat.id, role: 'user', items: '[]' }).execute();
        await database.db.deleteFrom('users').where('id', '=', userId).execute();
        expect(await database.db.selectFrom('agent_chats').select('id').where('id', '=', chat.id).execute()).toEqual([]);
        expect(await database.db.selectFrom('agent_messages').select('id').where('chat_id', '=', chat.id).execute()).toEqual([]);
    });

    it('rolls back and applies again without touching library data', async () => {
        const userId = await seedUser(database.db, 'migrator');

        await down(untyped());
        expect(await tablesExist()).toBe(false);
        expect((await database.db.selectFrom('users').select('id').where('id', '=', userId).execute()).length).toBe(1);

        await up(untyped());
        expect(await tablesExist()).toBe(true);
    });
});
