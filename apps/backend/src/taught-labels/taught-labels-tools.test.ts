import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { toVectorLiteral } from '../embeddings/embedding.repository';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument } from '../testing/seed.js';
import { describeDb, refusal, run, useWorld } from '../testing/tool-world.js';
import { loadTagNames } from '../testing/write-helpers.js';
import { propagateForDocument } from './propagation';
import { teachLabel } from './taught-labels.service';

describeDb('taught labels through the agent tools', () => {
    const ctx = useWorld();
    let counter = 0;
    /** Each test looks along its own axis, so one test's label never matches another test's images (they share a user). */
    let axis = 0;
    const db = () => ctx.world().db;
    const alice = () => ctx.world().alice;

    async function image(cosine: number, deleted = false, folderId: string | null = null): Promise<string> {
        const id = await seedDocument(db(), { userId: alice(), name: 'tool-img-' + ++counter + '.jpg', mime: 'image/jpeg', deleted, folderId });
        const embedding = toVectorLiteral(leaning(IMAGE_DIMENSIONS, axis, cosine));

        await db()
            .insertInto('document_image_embeddings')
            .values({ document_id: id, content_hash: 'h', model: IMAGE_MODEL.name, model_version: IMAGE_MODEL.revision, embedding })
            .execute();

        return id;
    }

    /** Every label here is unique, so the library the world already holds can't match it. */
    const label = () => {
        axis = ++counter;

        return 'tooltag-' + counter;
    };

    it('makes taught tags searchable like any tag, and never reveals private or trashed images through them', async () => {
        const { folders, alice: userId } = ctx.world();
        const name = label();
        const [example, close, inVault, trashed] = [await image(1), await image(0.97), await image(0.98, false, folders.vault.id), await image(0.99, true)];

        await teachLabel(userId, name, [example]);

        const found = (await run(userId, 'search_documents', { tags: [name] })).rows.map((row: { id: string }) => row.id);

        expect(found.sort()).toEqual([example, close].sort());
        expect(found).not.toContain(inVault);
        expect(found).not.toContain(trashed);
        expect(await loadTagNames(db(), inVault)).toContain(name);
    });

    it('remove_tags on a taught tag keeps the image off the label; undo_write brings both back', async () => {
        const name = label();
        const [example, victim] = [await image(1), await image(0.96)];

        await teachLabel(alice(), name, [example]);
        expect(await loadTagNames(db(), victim)).toEqual([name]);

        const out = await run(alice(), 'remove_tags', { document_ids: [victim], tags: [name] });

        expect(await loadTagNames(db(), victim)).toEqual([]);
        await propagateForDocument(db(), victim);
        expect(await loadTagNames(db(), victim)).toEqual([]);

        await run(alice(), 'undo_write', { audit_id: out.audit_id });
        expect(await loadTagNames(db(), victim)).toEqual([name]);
        expect(await db().selectFrom('document_tags').select('source').where('document_id', '=', victim).executeTakeFirstOrThrow()).toEqual({
            source: 'taught',
        });

        // The exclusion is gone with the undo: removing the tag from the label is no longer remembered.
        const exclusions = await db().selectFrom('taught_label_exclusions').select('document_id').where('document_id', '=', victim).execute();

        expect(exclusions).toEqual([]);
    });

    it('refuses to remove a taught tag from one of its example images', async () => {
        const name = label();
        const example = await image(1);

        await teachLabel(alice(), name, [example]);
        expect(await refusal(alice(), 'remove_tags', { document_ids: [example], tags: [name] })).toMatch(
            /^Cannot remove a taught label from one of its example images: /,
        );
        expect(await loadTagNames(db(), example)).toEqual([name]);
    });
});
