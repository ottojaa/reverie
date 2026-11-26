import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { toVectorLiteral } from '../embeddings/embedding.repository';
import { dbProxy } from '../testing/db-proxy.js';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { parseQuery } from './query-parser';
import { findSimilarImages } from './similar-images';

describeDb('similar images', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let otherId: string;
    let source: string;
    let vaultId: string;
    const near: string[] = [];
    const hidden: Record<'private' | 'trashed' | 'foreign' | 'differentModel', string> = { private: '', trashed: '', foreign: '', differentModel: '' };

    async function embed(documentId: string, cosine: number, model: { name: string; revision: string } = IMAGE_MODEL) {
        await db
            .insertInto('document_image_embeddings')
            .values({
                document_id: documentId,
                content_hash: 'h',
                model: model.name,
                model_version: model.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, 0, cosine)),
            })
            .execute();
    }

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
        otherId = await seedUser(db, 'other');

        const vault = await seedFolder(db, userId, 'vault', { isPrivate: true });

        vaultId = vault.id;
        source = await seedDocument(db, { userId, name: 'source.jpg', mime: 'image/jpeg' });
        await embed(source, 1);

        for (const [index, cosine] of [0.9, 0.7, 0.5, 0.3].entries()) {
            near.push(await seedDocument(db, { userId, name: `near${index}.jpg`, mime: 'image/jpeg' }));
            await embed(near[index]!, cosine);
        }

        hidden.private = await seedDocument(db, { userId, name: 'private.jpg', mime: 'image/jpeg', folderId: vault.id });
        hidden.trashed = await seedDocument(db, { userId, name: 'trashed.jpg', mime: 'image/jpeg', deleted: true });
        hidden.foreign = await seedDocument(db, { userId: otherId, name: 'foreign.jpg', mime: 'image/jpeg' });
        hidden.differentModel = await seedDocument(db, { userId, name: 'old-model.jpg', mime: 'image/jpeg' });

        for (const id of [hidden.private, hidden.trashed, hidden.foreign]) await embed(id, 0.99);

        await embed(hidden.differentModel, 0.99, { name: 'older-image-model', revision: 'rev-0' });
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });

    const find = (options: { limit: number; offset: number }) => findSimilarImages(userId, [vaultId], source, options);

    it('lists only the owner’s visible images of the same model, nearest first, without the source', async () => {
        const result = await find({ limit: 10, offset: 0 });

        expect(result?.entries.map((entry) => entry.id)).toEqual(near);
        expect(result?.total).toBe(4);
        expect(result?.entries[0]?.similarity).toBeCloseTo(0.9, 3);
    });

    it('pages without repeating or skipping an image, and keeps the total', async () => {
        const first = await find({ limit: 3, offset: 0 });
        const second = await find({ limit: 3, offset: 3 });

        expect([...first!.entries, ...second!.entries].map((entry) => entry.id)).toEqual(near);
        expect(first?.total).toBe(4);
        expect(second?.total).toBe(4);
    });

    it('applies filters on top', async () => {
        const result = await findSimilarImages(userId, [vaultId], source, { limit: 10, offset: 0, filters: parseQuery('near0') });

        // Free text is ignored: "similar" never turns into a keyword search.
        expect(result?.entries).toHaveLength(4);

        const folder = await seedFolder(db, userId, 'trip');
        const deeper = await seedFolder(db, userId, 'day one', { parent: await seedFolder(db, userId, 'rome', { parent: folder }) });
        const inFolder = await seedDocument(db, { userId, name: 'trip.jpg', mime: 'image/jpeg', folderId: deeper.id });

        await embed(inFolder, 0.6);

        const filtered = await findSimilarImages(userId, [vaultId], source, { limit: 10, offset: 0, filters: { ...parseQuery(''), scopeFolderId: folder.id } });

        expect(filtered?.entries.map((entry) => entry.id)).toEqual([inFolder]);
    });

    it('is null for a document that has no image embedding', async () => {
        const pdf = await seedDocument(db, { userId, name: 'plain.pdf' });

        expect(await findSimilarImages(userId, [vaultId], pdf, { limit: 10, offset: 0 })).toBeNull();
    });
});
