import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { toVectorLiteral } from '../embeddings/embedding.repository';
import { embedDocumentImage } from '../embeddings/embedding.service';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld } from '../testing/tool-world.js';
import { findCandidates } from './matching';
import { propagateForDocument } from './propagation';
import { loadLabelByName } from './taught-labels.repository';
import {
    addLabelExamples,
    deleteLabel,
    loadLabelMembers,
    loadSimilarities,
    removeLabelExample,
    removeLabelMatch,
    setLabelThreshold,
    teachLabel,
} from './taught-labels.service';

/**
 * Vectors that all lean towards one axis: `vec(c)` has cosine `c` to `vec(1)`, and two vectors `vec(a)`, `vec(b)` sit
 * at cosine cos(acos(a) - acos(b)) from each other. Names like `lunamux-3` keep each test's label apart.
 */
const vec = (cosine: number) => leaning(IMAGE_DIMENSIONS, 0, cosine);

describeDb('taught labels', () => {
    const ctx = useWorld();
    let counter = 0;
    const db = (): Kysely<Database> => ctx.world().db;
    /** Each test gets its own user, so images from other tests can't match its label. */
    const newUser = () => seedUser(db(), 'owner-' + ++counter);
    const label = () => 'lunamux-' + ++counter;

    /** An image of `owner` with a stored embedding (none when `cosine` is omitted). */
    async function image(owner: string, cosine?: number, opts: { folderId?: string | null; deleted?: boolean } = {}): Promise<string> {
        const id = await seedDocument(db(), {
            userId: owner,
            name: 'img-' + ++counter + '.jpg',
            mime: 'image/jpeg',
            folderId: opts.folderId ?? null,
            deleted: opts.deleted,
        });

        if (cosine !== undefined) await embed(id, vec(cosine));

        return id;
    }

    const embed = (id: string, vector: number[]) =>
        db()
            .insertInto('document_image_embeddings')
            .values({ document_id: id, content_hash: 'h', model: IMAGE_MODEL.name, model_version: IMAGE_MODEL.revision, embedding: toVectorLiteral(vector) })
            .onConflict((oc) => oc.column('document_id').doUpdateSet({ embedding: toVectorLiteral(vector) }))
            .execute();

    const tagged = async (name: string, ids: string[]): Promise<string[]> => {
        const rows = await db().selectFrom('document_tags').select('document_id').where('tag', '=', name).where('document_id', 'in', ids).execute();
        const found = new Set(rows.map((row) => row.document_id));

        return ids.filter((id) => found.has(id));
    };

    describeThreshold();
    describePropagation();
    describeExclusions();
    describeRules();

    function describeThreshold() {
        it('starts at 0.85 for one example, from the examples’ own spread for several, and stays inside 0.7 to 0.95', async () => {
            const me = await newUser();
            const name = label();
            const first = await image(me, 1);
            const one = await teachLabel(me, name, [first]);

            expect(one.label.threshold).toBe(0.85);

            const second = await image(me, 0.9);
            const two = await addLabelExamples(me, one.label.id, [second]);

            expect(two.label.threshold).toBe(0.9);

            const loose = label();
            const far = await teachLabel(me, loose, [await image(me, 1), await image(me, 0.3)]);

            expect(far.label.threshold).toBe(0.7);

            const tight = label();
            const near = await teachLabel(me, tight, [await image(me, 1), await image(me, 0.999)]);

            expect(near.label.threshold).toBe(0.95);
        });

        it('follows the examples until the owner moves the threshold', async () => {
            const me = await newUser();
            const name = label();
            const taught = await teachLabel(me, name, [await image(me, 1), await image(me, 0.9)]);
            const added = await addLabelExamples(me, taught.label.id, [await image(me, 0.2)]);

            // 1.0 / 0.9 / 0.2: the median nearest-sibling similarity is still 0.9.
            expect(added.label.threshold_is_custom).toBe(false);

            const moved = await setLabelThreshold(me, taught.label.id, 0.8);

            expect(moved).toMatchObject({ threshold: 0.8, threshold_is_custom: true });

            const again = await addLabelExamples(me, taught.label.id, [await image(me, 0.95)]);

            expect(again.label).toMatchObject({ threshold: 0.8, threshold_is_custom: true });
        });
    }

    function describePropagation() {
        it('tags the examples and every image that looks like them when the label is created', async () => {
            const me = await newUser();
            const name = label();
            const [a, b] = [await image(me, 1), await image(me, 0.9)];
            const [close, far, unembedded] = [await image(me, 0.95), await image(me, 0.5), await image(me)];
            const result = await teachLabel(me, name, [a, b]);

            expect(result).toMatchObject({ added: 2, skipped: 0 });
            expect(await tagged(name, [a, b, close, far, unembedded])).toEqual([a, b, close]);

            const rows = await db().selectFrom('document_tags').select('source').where('tag', '=', name).execute();

            expect(rows.every((row) => row.source === 'taught')).toBe(true);
        });

        it('re-applies the label when its threshold or examples change', async () => {
            const me = await newUser();
            const name = label();
            const [a, b] = [await image(me, 1), await image(me, 0.9)];
            // 0.6 sits 0.6 from the first example and 0.889 from the second: below the 0.9 the pair starts at.
            const [near, mid] = [await image(me, 0.97), await image(me, 0.6)];
            const { label: created } = await teachLabel(me, name, [a, b]);

            expect(await tagged(name, [near, mid])).toEqual([near]);

            await setLabelThreshold(me, created.id, 0.7);
            expect(await tagged(name, [near, mid])).toEqual([near, mid]);

            await setLabelThreshold(me, created.id, 0.99);
            expect(await tagged(name, [a, b, near, mid])).toEqual([a, b]);

            await removeLabelExample(me, created.id, b);
            expect(await tagged(name, [a, b])).toEqual([a]);
        });

        it('tags a newly embedded image that matches, and re-labels the library when the new image is an example', async () => {
            const me = await newUser();
            const name = label();
            const { label: created } = await teachLabel(me, name, [await image(me, 1)]);
            const ml = createFakeMl();
            const deps = { db: db(), ml, readFile: async (path: string) => Buffer.from(path) };

            const make = async (path: string, cosine: number) => {
                const id = await seedDocument(db(), { userId: me, name: path + '.jpg', mime: 'image/jpeg' });

                await db()
                    .updateTable('documents')
                    .set({ thumbnail_paths: { sm: path, md: path, lg: path } })
                    .where('id', '=', id)
                    .execute();
                ml.setImageVector(path, vec(cosine));

                return id;
            };

            const [alike, unlike] = [await make('/alike', 0.95), await make('/unlike', 0.4)];

            await embedDocumentImage(deps, alike);
            await embedDocumentImage(deps, unlike);
            expect(await tagged(name, [alike, unlike])).toEqual([alike]);

            // An example whose embedding arrives later teaches the label its look: images near it now match.
            const lateExample = await make('/late', 0.4);
            const nearLate = await image(me, 0.45);

            await addLabelExamples(me, created.id, [lateExample]);
            await embedDocumentImage(deps, lateExample);
            expect(await tagged(name, [lateExample, unlike, nearLate])).toEqual([lateExample, unlike, nearLate]);
        });

        it('creates a label that matches nothing but its examples while the examples have no vectors yet', async () => {
            const me = await newUser();
            const name = label();
            const [bare, other] = [await image(me), await image(me, 0.99)];
            const result = await teachLabel(me, name, [bare]);

            expect(result.label.threshold).toBe(0.85);
            expect(await tagged(name, [bare, other])).toEqual([bare]);
        });

        it('skips documents that are not images and refuses a selection with none', async () => {
            const me = await newUser();
            const name = label();
            const pdf = await seedDocument(db(), { userId: me, name: 'doc.pdf' });
            const result = await teachLabel(me, name, [await image(me, 1), pdf]);

            expect(result).toMatchObject({ added: 1, skipped: 1 });
            await expect(teachLabel(me, label(), [pdf])).rejects.toThrow('None of the selected documents is an image');
        });
    }

    function describeExclusions() {
        it('keeps a removed label off the image: not re-added by a threshold change, an edit, or a new embedding', async () => {
            const me = await newUser();
            const name = label();
            const [a, b, victim] = [await image(me, 1), await image(me, 0.9), await image(me, 0.96)];
            const { label: created } = await teachLabel(me, name, [a, b]);

            expect(await tagged(name, [victim])).toEqual([victim]);

            await removeLabelMatch(me, created.id, victim);
            expect(await tagged(name, [victim])).toEqual([]);

            await setLabelThreshold(me, created.id, 0.6);
            await addLabelExamples(me, created.id, [await image(me, 0.99)]);
            await propagateForDocument(db(), victim);
            expect(await tagged(name, [victim])).toEqual([]);
            expect((await findCandidates(db(), created, { minSimilarity: 0.5 })).map((c) => c.documentId)).not.toContain(victim);
        });

        it('teaching an excluded image as an example lifts the exclusion', async () => {
            const me = await newUser();
            const name = label();
            const [a, victim] = [await image(me, 1), await image(me, 0.97)];
            const { label: created } = await teachLabel(me, name, [a]);

            await removeLabelMatch(me, created.id, victim);
            await addLabelExamples(me, created.id, [victim]);
            expect(await tagged(name, [victim])).toEqual([victim]);
        });

        it('removing the label from an example also drops it as an example', async () => {
            const me = await newUser();
            const name = label();
            const [a, b] = [await image(me, 1), await image(me, 0.9)];
            const { label: created } = await teachLabel(me, name, [a, b]);

            await removeLabelMatch(me, created.id, b);

            const members = await loadLabelMembers(created, [], { limit: 10, offset: 0 });

            expect(members.exampleIds).toEqual([a]);
            expect(await tagged(name, [b])).toEqual([]);
            expect((await loadLabelByName(db(), me, name))?.threshold).toBe(0.85);
        });
    }

    function describeRules() {
        it('never touches another user’s images, and another user’s label never touches this user’s', async () => {
            const me = await newUser();
            const [bob, aliceId] = [await newUser(), me];
            const bobsImage = await image(bob, 0.99);
            const bobName = label();
            const alicesName = label();
            const bobsLabel = await teachLabel(bob, bobName, [await image(bob, 1)]);
            const alices = await teachLabel(aliceId, alicesName, [await image(me, 1)]);
            const alicesImage = await image(me, 0.99);

            await propagateForDocument(db(), alicesImage);
            expect(await tagged(alicesName, [bobsImage])).toEqual([]);
            expect(await tagged(bobName, [alicesImage])).toEqual([]);
            expect(await tagged(bobName, [bobsImage])).toEqual([bobsImage]);
            await expect(setLabelThreshold(aliceId, bobsLabel.label.id, 0.6)).rejects.toThrow('not found');
            await expect(deleteLabel(bob, alices.label.id)).rejects.toThrow('not found');
        });

        it('leaves trashed images alone, and a trashed example teaches nothing', async () => {
            const me = await newUser();
            const name = label();
            const trashed = await image(me, 0.99, { deleted: true });
            const trashedExample = await image(me, 0.3, { deleted: true });
            const [a, nearTrashedExample] = [await image(me, 1), await image(me, 0.35)];
            const { label: created } = await teachLabel(me, name, [a]);

            await db().insertInto('taught_label_examples').values({ label_id: created.id, document_id: trashedExample }).execute();
            await setLabelThreshold(me, created.id, 0.8);
            expect(await tagged(name, [trashed, trashedExample, nearTrashedExample])).toEqual([]);
            expect((await loadSimilarities(created, [])).similarities).toEqual([]);
        });

        it('lets a private image receive the label but never lists or counts it for the owner', async () => {
            const me = await newUser();
            const vault = await seedFolder(db(), me, 'Vault', { isPrivate: true });
            const inner = await seedFolder(db(), me, 'Inner', { parent: vault });
            const name = label();
            const inVault = await image(me, 0.98, { folderId: inner.id });
            const open = await image(me, 0.97);
            const { label: created } = await teachLabel(me, name, [await image(me, 1)]);
            const privateFolderIds = [vault.id, inner.id];

            expect(await tagged(name, [inVault, open])).toEqual([inVault, open]);

            const members = await loadLabelMembers(created, privateFolderIds, { limit: 10, offset: 0 });

            expect(members.matchIds).toEqual([open]);
            expect(members.matchTotal).toBe(1);

            const { similarities } = await loadSimilarities(created, privateFolderIds);

            // Only the open image's 0.97: the vault image's 0.98 would give away that it exists.
            expect(similarities).toHaveLength(1);
            expect(similarities[0]).toBeCloseTo(0.97, 3);
        });

        it('lists the similarity of every candidate for the manager’s live count, examples and exclusions left out', async () => {
            const me = await newUser();
            const name = label();
            const [a, near, mid, farOff] = [await image(me, 1), await image(me, 0.93), await image(me, 0.8), await image(me, 0.3)];
            const { label: created } = await teachLabel(me, name, [a]);

            await removeLabelMatch(me, created.id, mid);

            const { similarities, floor, truncated } = await loadSimilarities(created, []);

            expect(similarities).toHaveLength(1);
            expect(similarities[0]).toBeCloseTo(0.93, 3);
            expect({ floor, truncated }).toEqual({ floor: 0.5, truncated: false });
            expect(await tagged(name, [farOff, near])).toEqual([near]);
        });

        it('deleting a label removes its taught tags (not other tags of the same name), the examples and the exclusions', async () => {
            const me = await newUser();
            const name = label();
            const [a, ownTag, victim] = [await image(me, 1), await image(me, 0.96), await image(me, 0.97)];
            const { label: created } = await teachLabel(me, name, [a]);

            await db().deleteFrom('document_tags').where('document_id', '=', ownTag).execute();
            await db().insertInto('document_tags').values({ document_id: ownTag, tag: name, source: 'user' }).execute();
            await removeLabelMatch(me, created.id, victim);
            await deleteLabel(me, created.id);

            expect(await tagged(name, [a, victim])).toEqual([]);
            expect(await tagged(name, [ownTag])).toEqual([ownTag]);
            expect(await db().selectFrom('taught_label_examples').select('document_id').where('label_id', '=', created.id).execute()).toEqual([]);
            expect(await db().selectFrom('taught_label_exclusions').select('document_id').where('label_id', '=', created.id).execute()).toEqual([]);
        });

        it('converts a matching auto tag to a taught one (an LLM reprocess drops auto tags) and leaves a user tag alone', async () => {
            const me = await newUser();
            const name = label();
            const [auto, user] = [await image(me, 0.96), await image(me, 0.97)];

            await db().insertInto('document_tags').values({ document_id: auto, tag: name, source: 'auto' }).execute();
            await db().insertInto('document_tags').values({ document_id: user, tag: name, source: 'user' }).execute();
            await teachLabel(me, name, [await image(me, 1)]);

            const rows = await db()
                .selectFrom('document_tags')
                .select(['document_id', 'source'])
                .where('tag', '=', name)
                .where('document_id', 'in', [auto, user])
                .execute();

            expect(Object.fromEntries(rows.map((row) => [row.document_id, row.source]))).toEqual({ [auto]: 'taught', [user]: 'user' });
        });
    }
});
