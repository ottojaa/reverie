import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/021_image_kind_seed_sets';

describeDb('migration 021 (image kind seed sets)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const hasTable = async (name: string) => {
        const result = await sql<{ found: boolean }>`SELECT to_regclass(${name}) IS NOT NULL AS found`.execute(database.db);

        return result.rows[0]!.found;
    };

    it('adds both tables empty, and a seed row follows its document and its set when they are deleted', async () => {
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.jpg', mime: 'image/jpeg' });

        expect(await hasTable('image_kind_seed_sets')).toBe(true);
        expect(await hasTable('image_kind_seeds')).toBe(true);

        await database.db.insertInto('image_kind_seed_sets').values({ version: 'v-test', model: 'm', model_version: '1', stats: '{}' }).execute();
        await database.db.insertInto('image_kind_seeds').values({ version: 'v-test', document_id: id, kind: 'photo' }).execute();
        await database.db.deleteFrom('documents').where('id', '=', id).execute();

        expect(await database.db.selectFrom('image_kind_seeds').selectAll().execute()).toEqual([]);

        await database.db.deleteFrom('image_kind_seed_sets').execute();
    });

    it('reverses completely, leaves documents alone, and applies again', async () => {
        const userId = await seedUser(database.db, 'second');
        const id = await seedDocument(database.db, { userId, name: 'b.jpg', mime: 'image/jpeg' });

        await down(untyped());
        expect(await hasTable('image_kind_seed_sets')).toBe(false);
        expect(await hasTable('image_kind_seeds')).toBe(false);
        expect(await database.db.selectFrom('documents').select('id').where('id', '=', id).execute()).toHaveLength(1);

        await up(untyped());
        expect(await hasTable('image_kind_seeds')).toBe(true);
    });
});
