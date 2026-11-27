import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { promoteToNormal, fetchLaneJob } from '../queues/lane';
import { dbProxy } from '../testing/db-proxy';
import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/031_processing_lane';

vi.mock('../config/env', () => ({ env: {} }));

describeDb('migration 031 (processing lane)', () => {
    let database: TestDatabase;
    let userId: string;
    // Migrations are written against an untyped Kysely.
    const untyped = () => database.db as unknown as Kysely<unknown>;

    beforeAll(async () => {
        database = await createTestDatabase();
        dbProxy.use(database.db);
        userId = await seedUser(database.db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database.close();
    });

    const laneOf = async (id: string) =>
        (await database.db.selectFrom('documents').select('processing_lane').where('id', '=', id).executeTakeFirstOrThrow()).processing_lane;

    it('puts a document inserted without a lane (older code) in the normal one, and accepts only the two lanes', async () => {
        const id = await seedDocument(database.db, { userId, name: 'a.pdf' });

        expect(await laneOf(id)).toBe('normal');
        await expect(sql`UPDATE documents SET processing_lane = 'urgent' WHERE id = ${id}`.execute(database.db)).rejects.toThrow(
            'documents_processing_lane_check',
        );
    });

    it('reverses, leaving the queue layer to treat every document as normal, and applies again', async () => {
        const id = await seedDocument(database.db, { userId, name: 'b.pdf' });

        // The deploy starts the new code before it migrates: until then there is no column.
        await down(untyped());
        expect(await fetchLaneJob(id, { priority: 10 })).toEqual({ lane: 'normal', options: { priority: 10 } });
        await expect(promoteToNormal(id)).resolves.toBeUndefined();

        await up(untyped());
        expect(await laneOf(id)).toBe('normal');
    });
});
