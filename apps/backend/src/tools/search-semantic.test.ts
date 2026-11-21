import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { toVectorLiteral } from '../embeddings/embedding.repository';
import { createSemanticSearch, setSemanticSearch } from '../search/semantic-rank';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, leaning, TEXT_DIMENSIONS, TEXT_MODEL, unit, type FakeMl } from '../testing/fake-ml';
import { describeDb, refusal, run, useWorld } from '../testing/tool-world';

/**
 * The agent's search ranks like the web search but sees less: photos stay out of the meaning streams
 * (their image content never goes to the model, and neither may a list of them), and the selection
 * only stands for matches the words found.
 */
describeDb('search_documents by meaning', () => {
    const { world } = useWorld();
    let ml: FakeMl;
    const QUERY = 'sunset at the beach';

    async function embedImage(id: string, cosine = 0.9) {
        await world()
            .db.insertInto('document_image_embeddings')
            .values({
                document_id: id,
                content_hash: 'h',
                model: IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, 1, cosine)),
            })
            .execute();
    }

    async function embedText(id: string, cosine = 0.9) {
        await world()
            .db.insertInto('document_text_embeddings')
            .values({
                document_id: id,
                chunk_index: 0,
                char_start: 0,
                char_end: 1,
                content_hash: 'h',
                model: TEXT_MODEL.name,
                model_version: TEXT_MODEL.revision,
                embedding: toVectorLiteral(leaning(TEXT_DIMENSIONS, 1, cosine)),
            })
            .execute();
    }

    beforeAll(async () => {
        const { docs } = world();

        ml = createFakeMl();
        ml.setTextVector(QUERY, unit(TEXT_DIMENSIONS, 1));
        ml.setImageTextVector(QUERY, unit(IMAGE_DIMENSIONS, 1));
        setSemanticSearch(createSemanticSearch(ml, { textFloor: 0.53, imageFloor: 0.17, topK: 20, breakerMs: 60_000 }));

        // Everything is a perfect meaning match, so only visibility decides what comes back.
        for (const id of Object.values(docs)) await embedImage(id);

        await embedText(docs.notes);
        await embedText(docs.inVault);
    }, 60_000);
    afterAll(() => setSemanticSearch(undefined));

    it('returns visible non-photo documents that match by meaning, flagged as such', async () => {
        const { alice, docs } = world();
        const out = await run(alice, 'search_documents', { query: QUERY });
        const ids = out.rows.map((row: { id: string }) => row.id);

        expect(ids).toEqual(expect.arrayContaining([docs.screenshot, docs.emptyExif, docs.notes, docs.invoice]));
        expect(out.rows.every((row: { match: string }) => row.match === 'meaning')).toBe(true);
    });

    it('never lists a photo, a locked, trashed or other user’s document from the meaning streams', async () => {
        const { alice, docs } = world();
        const out = await run(alice, 'search_documents', { query: QUERY, limit: 100 });
        const ids = out.rows.map((row: { id: string }) => row.id);

        for (const hidden of [
            docs.photo,
            docs.captioned,
            docs.inLockedFolder,
            docs.inVault,
            docs.inVaultInner,
            docs.trashed,
            docs.inTrashedFolder,
            docs.bobs,
        ]) {
            expect(ids).not.toContain(hidden);
        }
    });

    it('leaves meaning-only matches out of the selection', async () => {
        const { alice } = world();
        const out = await run(alice, 'search_documents', { query: QUERY });

        expect(out.total).toBeGreaterThan(0);
        expect(out.selection_id).toBeNull();
        expect(out.selection_total).toBe(0);
    });

    it('keeps the selection to the matches the words found', async () => {
        const { alice, docs } = world();
        const out = await run(alice, 'search_documents', { query: 'invoice' });

        expect(out.rows[0].id).toBe(docs.invoice);
        expect(out.rows[0].match).toBe('keywords');
        expect(out.selection_total).toBe(1);
    });

    it('finds images that look like a visible image, and only visible ones', async () => {
        const { alice, docs } = world();
        const out = await run(alice, 'search_documents', { query: '', similar_to: docs.screenshot, limit: 100 });
        const ids = out.rows.map((row: { id: string }) => row.id);

        expect(ids).toContain(docs.emptyExif);
        expect(ids).not.toContain(docs.screenshot);

        for (const hidden of [docs.photo, docs.captioned, docs.gpsOnly, docs.inVault, docs.trashed, docs.bobs]) expect(ids).not.toContain(hidden);

        expect(out.rows[0]).toHaveProperty('similarity');
        expect(out.selection_id).toBeNull();
    });

    it('refuses a photo, a hidden or another user’s image as the source, and a query beside it', async () => {
        const { alice, docs } = world();

        expect(await refusal(alice, 'search_documents', { query: '', similar_to: docs.photo })).toContain('Image not found');
        expect(await refusal(alice, 'search_documents', { query: '', similar_to: docs.inVault })).toContain('Image not found');
        expect(await refusal(alice, 'search_documents', { query: '', similar_to: docs.bobs })).toContain('Image not found');
        expect(await refusal(alice, 'search_documents', { query: 'x', similar_to: docs.screenshot })).toContain('Invalid search');
    });

    it('asks reverie-ml nothing for a similar_to search', async () => {
        const { alice, docs } = world();

        ml.textCalls.length = 0;
        ml.imageTextCalls.length = 0;
        await run(alice, 'search_documents', { query: '', similar_to: docs.screenshot });

        expect(ml.textCalls).toEqual([]);
        expect(ml.imageTextCalls).toEqual([]);
    });
});
