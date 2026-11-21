import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/022_media_metadata';

describeDb('migration 022 (media metadata)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const hasColumn = async (table: string, column: string) => {
        const result = await sql<{ found: boolean }>`
            SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}) AS found
        `.execute(database.db);

        return result.rows[0]!.found;
    };

    it('adds the columns empty, and a video row follows its document when it is deleted', async () => {
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.mov', mime: 'video/quicktime', photo: { city: 'Helsinki' } });

        expect(await hasColumn('photo_metadata', 'iso')).toBe(true);
        expect(await hasColumn('documents', 'media_read_at')).toBe(true);
        expect(await database.db.selectFrom('photo_metadata').select(['iso', 'taken_at_offset']).where('document_id', '=', id).executeTakeFirst()).toEqual({
            iso: null,
            taken_at_offset: null,
        });
        expect((await database.db.selectFrom('documents').select('media_read_at').where('id', '=', id).executeTakeFirstOrThrow()).media_read_at).toBeNull();

        await database.db.insertInto('video_metadata').values({ document_id: id, video_codec: 'hevc' }).execute();
        expect((await database.db.selectFrom('video_metadata').select('is_hdr').executeTakeFirstOrThrow()).is_hdr).toBe(false);

        await database.db.deleteFrom('documents').where('id', '=', id).execute();
        expect(await database.db.selectFrom('video_metadata').selectAll().execute()).toEqual([]);
    });

    it('reverses completely, leaves documents and the older photo columns alone, and applies again', async () => {
        const userId = await seedUser(database.db, 'second');
        const id = await seedDocument(database.db, { userId, name: 'b.jpg', mime: 'image/jpeg', photo: { city: 'Turku', cameraMake: 'Apple' } });

        await down(untyped());
        expect(await hasColumn('photo_metadata', 'iso')).toBe(false);
        expect(await hasColumn('documents', 'media_read_at')).toBe(false);
        expect(
            await sql<{ found: boolean }>`SELECT to_regclass('video_metadata') IS NOT NULL AS found`.execute(database.db).then((r) => r.rows[0]!.found),
        ).toBe(false);
        expect(await database.db.selectFrom('documents').select('id').where('id', '=', id).execute()).toHaveLength(1);
        expect(await database.db.selectFrom('photo_metadata').select(['city', 'camera_make']).where('document_id', '=', id).executeTakeFirst()).toEqual({
            city: 'Turku',
            camera_make: 'Apple',
        });

        await up(untyped());
        expect(await hasColumn('photo_metadata', 'pixel_height')).toBe(true);
        expect(await hasColumn('documents', 'media_read_at')).toBe(true);
    });
});
