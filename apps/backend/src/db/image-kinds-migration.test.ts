import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/019_image_kinds';

describeDb('migration 019 (image kinds)', () => {
    let database: TestDatabase;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    async function present(): Promise<{ table: boolean; columns: string[] }> {
        const table = await sql<{ found: boolean }>`SELECT to_regclass('public.document_image_kinds') IS NOT NULL AS found`.execute(database.db);
        const columns = await sql<{ table_name: string; column_name: string }>`
            SELECT table_name, column_name FROM information_schema.columns
            WHERE (table_name = 'photo_metadata' AND column_name IN ('camera_make', 'camera_model', 'lens_model'))
               OR (table_name = 'documents' AND column_name = 'ocr_facts_at')
            ORDER BY table_name, column_name
        `.execute(database.db);

        return { table: table.rows[0]!.found, columns: columns.rows.map((row) => `${row.table_name}.${row.column_name}`) };
    }

    it('adds the verdict table and the three camera columns and the OCR marker', async () => {
        expect(await present()).toEqual({
            table: true,
            columns: ['documents.ocr_facts_at', 'photo_metadata.camera_make', 'photo_metadata.camera_model', 'photo_metadata.lens_model'],
        });
    });

    it('removes a verdict with its document, and keeps one verdict per document', async () => {
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.jpg', mime: 'image/jpeg' });
        const row = { document_id: id, kind: 'photo', scores: '{}', signals: '{}', prompt_version: 'v1', model: 'm', model_version: 'r' };

        await database.db.insertInto('document_image_kinds').values(row).execute();
        await expect(database.db.insertInto('document_image_kinds').values(row).execute()).rejects.toThrow();

        await database.db.deleteFrom('documents').where('id', '=', id).execute();

        expect(await database.db.selectFrom('document_image_kinds').select('document_id').execute()).toEqual([]);
    });

    it('reverses completely, leaves the existing columns alone, and applies again', async () => {
        const userId = await seedUser(database.db, 'second');
        const id = await seedDocument(database.db, { userId, name: 'b.jpg', mime: 'image/jpeg', photo: { takenAt: new Date('2025-06-01') } });

        await down(untyped());
        expect(await present()).toEqual({ table: false, columns: [] });

        const kept = await database.db.selectFrom('photo_metadata').select(['taken_at']).where('document_id', '=', id).executeTakeFirstOrThrow();

        expect(kept.taken_at).toEqual(new Date('2025-06-01'));

        await up(untyped());
        expect((await present()).table).toBe(true);
    });
});
