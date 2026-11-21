import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { toVectorLiteral } from '../embeddings/embedding.repository';
import { loadScanConfig, scanDuplicates } from '../duplicates/scan';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml';
import { seedDocument, seedUser } from '../testing/seed';
import { describeDb, run, useWorld } from '../testing/tool-world';

/** Vectors a few degrees apart: far above any sane threshold. */
const vec = (cosine: number) => leaning(IMAGE_DIMENSIONS, 0, cosine);

describeDb('find_duplicates', () => {
    const { world } = useWorld();

    async function embed(id: string, cosine: number) {
        await world()
            .db.insertInto('document_image_embeddings')
            .values({
                document_id: id,
                content_hash: 'h',
                model: IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(vec(cosine)),
            })
            .execute();
        await scanDuplicates(id, loadScanConfig());
    }

    it('lists groups of look-alike images with what the tools may show, and leaves photos, private and trashed images out', async () => {
        const { db, folders } = world();
        const me = await seedUser(db, 'dupe-tool-owner');
        const shot = (name: string, extra: object = {}) => seedDocument(db, { userId: me, name, mime: 'image/png', category: 'screenshot', ...extra });
        const first = await shot('Screenshot 1.png');
        const second = await shot('Screenshot 1 (Copy).png');
        const trashed = await shot('Screenshot 1 old.png', { deleted: true });
        const camera = { cameraMake: 'Canon', takenAt: new Date('2022-07-15T12:00:00Z') };
        const photoA = await seedDocument(db, { userId: me, name: 'IMG_1.jpg', mime: 'image/jpeg', category: 'photo', photo: camera });
        const photoB = await seedDocument(db, { userId: me, name: 'IMG_2.jpg', mime: 'image/jpeg', category: 'photo', photo: camera });
        const aliceOnly = await seedDocument(db, {
            userId: world().alice,
            name: 'alice.png',
            mime: 'image/png',
            category: 'screenshot',
            folderId: folders.vault.id,
        });

        for (const [id, cosine] of [
            [first, 1],
            [second, 0.9999],
            [trashed, 0.9998],
            [photoA, 1],
            [photoB, 0.9999],
            [aliceOnly, 1],
        ] as const)
            await embed(id, cosine);

        const output = await run(me, 'find_duplicates');

        expect(output.total).toBe(1);
        expect(output.groups[0].images.map((image: { id: string }) => image.id).sort()).toEqual([first, second].sort());
        expect(output.groups[0].images[0]).toMatchObject({ filename: expect.any(String), size_bytes: 100, folder: null });

        // The original is the suggested copy: it is not named like an edited copy.
        expect(output.groups[0].suggested_keep_id).toBe(first);

        const text = JSON.stringify(output);

        for (const hidden of [photoA, photoB, trashed, aliceOnly, 'IMG_1.jpg', 'IMG_2.jpg']) expect(text).not.toContain(hidden);
    });

    it('answers with no groups for a library that has none', async () => {
        const me = await seedUser(world().db, 'dupe-tool-empty');

        expect(await run(me, 'find_duplicates')).toEqual({ total: 0, groups: [], truncated: false });
    });
});
