import { sql, type Kysely } from 'kysely';
import { expect, it, onTestFinished, vi } from 'vitest';

vi.mock('../db/kysely', () => ({ db: {} }));

import { seedDocument, seedUser } from '../testing/seed';
import { createTestDatabase } from '../testing/test-database';
import { describeDb } from '../testing/tool-world';
import { down, up } from './migrations/031_processing_lane';

describeDb('migration 031 (processing lane)', () => {
    it('defaults to the normal lane, accepts only the two lanes, and reverses', async () => {
        const database = await createTestDatabase();
        onTestFinished(() => database.close());
        const userId = await seedUser(database.db, 'owner');
        const id = await seedDocument(database.db, { userId, name: 'a.pdf' });

        const lane = await database.db.selectFrom('documents').select('processing_lane').where('id', '=', id).executeTakeFirstOrThrow();

        expect(lane.processing_lane).toBe('normal');
        await expect(sql`UPDATE documents SET processing_lane = 'urgent' WHERE id = ${id}`.execute(database.db)).rejects.toThrow(
            'documents_processing_lane_check',
        );

        // Migrations are written against an untyped Kysely. Adding the column again only works if `down` removed it.
        const untyped = database.db as unknown as Kysely<unknown>;
        await down(untyped);
        await up(untyped);
    }, 60_000);
});
