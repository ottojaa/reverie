import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { SearchQuery } from '@reverie/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { toVectorLiteral } from '../embeddings/embedding.repository';
import { createMlClient } from '../embeddings/ml.client';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, leaning, TEXT_DIMENSIONS, TEXT_MODEL, unit, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { findRankedDocuments } from './hybrid-search';
import { parseQuery } from './query-parser';
import { search } from './search.service';
import { createSemanticSearch, setSemanticSearch, type SemanticConfig, type SemanticMatches } from './semantic-rank';

const CONFIG: SemanticConfig = { textFloor: 0.53, imageFloor: 0.17, topK: 5, breakerMs: 60_000 };
const NO_MEANING: SemanticMatches = { active: false, text: [], image: [], ids: [], fullTextDepth: 70 };

describeDb('hybrid search', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });
    beforeEach(() => {
        ml = createFakeMl();
        setSemanticSearch(createSemanticSearch(ml, CONFIG));
    });
    afterAll(() => setSemanticSearch(undefined));

    /** Every query in a test uses its own words, so documents seeded by other tests can't match it. */
    let counter = 0;
    const word = (label: string) => label + (counter += 1);

    /**
     * The database is shared by every test here, so each query gets its own axis: a document embedded
     * `leaning` c on a query's axis is c-similar to that query and orthogonal to every other one.
     */
    const axes = new Map<string, number>();

    function pinQuery(text: string) {
        const axis = axes.size + 1;

        axes.set(text, axis);
        ml.setTextVector(text, unit(TEXT_DIMENSIONS, axis));
        ml.setImageTextVector(text, unit(IMAGE_DIMENSIONS, axis));
    }

    async function embedText(documentId: string, query: string, cosine: number) {
        await db
            .insertInto('document_text_embeddings')
            .values({
                document_id: documentId,
                chunk_index: 0,
                char_start: 0,
                char_end: 1,
                content_hash: 'h',
                model: TEXT_MODEL.name,
                model_version: TEXT_MODEL.revision,
                embedding: toVectorLiteral(leaning(TEXT_DIMENSIONS, axes.get(query)!, cosine)),
            })
            .execute();
    }

    async function embedImage(documentId: string, query: string, cosine: number) {
        await db
            .insertInto('document_image_embeddings')
            .values({
                document_id: documentId,
                content_hash: 'h',
                model: IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, axes.get(query)!, cosine)),
            })
            .execute();
    }

    const find = (q: string, extra: Partial<SearchQuery> = {}, user = userId) =>
        search({ q, limit: 50, offset: 0, sort_by: 'relevance', sort_order: 'desc', include_facets: false, ...extra } as SearchQuery, { userId: user });
    const idsOf = async (q: string, extra: Partial<SearchQuery> = {}) =>
        (await find(q, extra)).results.map((hit) => (hit.result_type === 'document' ? hit.document_id : hit.id));

    it('keeps an exact word match first even when a document is the top meaning match on both streams', async () => {
        const q = word('invoice');
        const exact = await seedDocument(db, { userId, name: 'exact.pdf', ocrText: q + ' total 120 euro' });
        const meaning = await seedDocument(db, { userId, name: 'meaning.pdf', ocrText: 'a bill for services' });

        pinQuery(q);
        await embedText(meaning, q, 0.95);
        await embedImage(meaning, q, 0.9);

        const response = await find(q);

        expect(response.results.map((hit) => hit.result_type === 'document' && hit.document_id)).toEqual([exact, meaning]);
        expect(response.results.map((hit) => hit.result_type === 'document' && hit.match)).toEqual(['keywords', 'meaning']);
        expect(response.total).toBe(2);
    });

    it('lists a document that matches by words and by meaning once, flagged as both', async () => {
        const q = word('lease');
        const both = await seedDocument(db, { userId, name: 'both.pdf', ocrText: q + ' agreement' });

        pinQuery(q);
        await embedText(both, q, 0.9);

        const response = await find(q);

        expect(response.results).toHaveLength(1);
        expect(response.results[0]).toMatchObject({ document_id: both, match: 'both' });
        expect(response.total).toBe(1);
    });

    it('drops documents below the floor on each stream', async () => {
        const q = word('sunset');
        const textAbove = await seedDocument(db, { userId, name: 'a.pdf', ocrText: 'evening glow' });
        const textBelow = await seedDocument(db, { userId, name: 'b.pdf', ocrText: 'quarterly report' });
        const imageAbove = await seedDocument(db, { userId, name: 'c.jpg', mime: 'image/jpeg' });
        const imageBelow = await seedDocument(db, { userId, name: 'd.jpg', mime: 'image/jpeg' });

        pinQuery(q);
        await embedText(textAbove, q, 0.54);
        await embedText(textBelow, q, 0.52);
        await embedImage(imageAbove, q, 0.18);
        await embedImage(imageBelow, q, 0.16);

        const ids = await idsOf(q);

        expect(ids).toContain(textAbove);
        expect(ids).toContain(imageAbove);
        expect(ids).not.toContain(textBelow);
        expect(ids).not.toContain(imageBelow);
    });

    it('never returns private, trashed or other users documents from either stream', async () => {
        const q = word('secret');
        const other = await seedUser(db, 'other');
        const vault = await seedFolder(db, userId, word('vault'), { isPrivate: true });
        const visible = await seedDocument(db, { userId, name: 'visible.pdf', ocrText: 'plain' });
        const hidden = {
            private: await seedDocument(db, { userId, name: 'private.pdf', ocrText: 'plain', folderId: vault.id }),
            trashed: await seedDocument(db, { userId, name: 'trashed.pdf', ocrText: 'plain', deleted: true }),
            foreign: await seedDocument(db, { userId: other, name: 'foreign.pdf', ocrText: 'plain' }),
        };

        pinQuery(q);

        for (const id of [visible, ...Object.values(hidden)]) {
            await embedText(id, q, 0.9);
            await embedImage(id, q, 0.9);
        }

        expect(await idsOf(q)).toEqual([visible]);
        expect((await find(q)).total).toBe(1);
        expect((await find(q, { include_facets: true })).facets?.formats).toEqual([{ name: 'pdf', count: 1, selected: false }]);
    });

    it('applies filters to the meaning streams as well', async () => {
        const q = word('lease');
        const pdf = await seedDocument(db, { userId, name: 'a.pdf', ocrText: 'rental' });
        const png = await seedDocument(db, { userId, name: 'b.png', mime: 'image/png' });
        const oldPdf = await seedDocument(db, { userId, name: 'c.pdf', ocrText: 'rental', extractedDate: new Date('2019-05-05') });

        pinQuery(q);

        for (const id of [pdf, png, oldPdf]) {
            await embedText(id, q, 0.9);
            await embedImage(id, q, 0.9);
        }

        expect(await idsOf(q + ' format:pdf')).toEqual(expect.arrayContaining([pdf, oldPdf]));
        expect(await idsOf(q + ' format:pdf')).not.toContain(png);
        expect(await idsOf(q + ' date:2019')).toEqual([oldPdf]);
    });

    it('lets a meaning match outrank a weaker word match, also under a filter', async () => {
        const q = word('contract');
        const strong = await seedDocument(db, { userId, name: 'strong.pdf', ocrText: `${q} ${q} ${q} ${q}` });
        const weak = await seedDocument(db, { userId, name: 'weak.pdf', ocrText: `${q} and a lot of other words that dilute the rank of this one`.repeat(3) });
        const meaning = await seedDocument(db, { userId, name: 'meaning.pdf', ocrText: 'a deal between two parties' });

        pinQuery(q);
        await embedText(meaning, q, 0.9);
        await embedImage(meaning, q, 0.9);

        const wordsOnly = await findRankedDocuments(
            parseQuery(q + ' format:pdf'),
            { userId, privateFolderIds: [] },
            { limit: 10, offset: 0, sortBy: 'relevance', sortOrder: 'desc' },
            NO_MEANING,
        );

        expect(wordsOnly.entries.map((entry) => entry.id)).toEqual([strong, weak]);
        expect(await idsOf(q)).toEqual([strong, meaning, weak]);
        expect(await idsOf(q + ' format:pdf')).toEqual([strong, meaning, weak]);
    });

    it('pages a fused list consistently: every document once, total equal to the sum of the pages', async () => {
        const q = word('ledger');
        const wordDocs: string[] = [];

        // Deeper than the full-text depth (2 * topK + 60 = 70), all with the same text so that ties decide the order.
        for (let i = 0; i < 74; i += 1) wordDocs.push(await seedDocument(db, { userId, name: `l${i}.pdf`, ocrText: q + ' entry' }));

        const baseline = await findRankedDocuments(
            parseQuery(q),
            { userId, privateFolderIds: [] },
            { limit: 100, offset: 0, sortBy: 'relevance', sortOrder: 'desc' },
            NO_MEANING,
        );
        const deepest = baseline.entries.at(-1)!.id;
        const meaningOnly = [
            await seedDocument(db, { userId, name: 'm1.pdf', ocrText: 'unrelated' }),
            await seedDocument(db, { userId, name: 'm2.pdf', ocrText: 'unrelated' }),
        ];

        pinQuery(q);
        await embedText(deepest, q, 0.95);
        await embedText(meaningOnly[0]!, q, 0.9);
        await embedImage(meaningOnly[1]!, q, 0.9);

        const pages: string[][] = [];
        let total = 0;

        for (let offset = 0; offset < 80; offset += 10) {
            const response = await find(q, { limit: 10, offset });

            total = response.total;
            pages.push(response.results.map((hit) => (hit.result_type === 'document' ? hit.document_id : hit.id)));
        }

        const all = pages.flat();
        const whole = await idsOf(q, { limit: 100 });

        expect(total).toBe(76);
        expect(all).toHaveLength(76);
        expect(new Set(all).size).toBe(76);
        expect(all).toEqual(whole);
        expect(new Set(all)).toEqual(new Set([...wordDocs, ...meaningOnly]));

        const both = (await find(q, { limit: 100 })).results.find((hit) => hit.result_type === 'document' && hit.document_id === deepest);

        expect(both).toMatchObject({ match: 'both' });
    });

    it('is the full-text result when reverie-ml is down, and asks it nothing for a filter-only query', async () => {
        const q = word('statement');
        const wordDoc = await seedDocument(db, { userId, name: 'w.pdf', ocrText: q });
        const meaning = await seedDocument(db, { userId, name: 'm.pdf', ocrText: 'a bank letter' });

        pinQuery(q);
        await embedText(meaning, q, 0.9);
        ml.setDown(true);

        const down = await find(q);

        expect(down.results.map((hit) => hit.result_type === 'document' && hit.document_id)).toEqual([wordDoc]);
        expect(down.results[0]).not.toHaveProperty('match');

        ml.setDown(false);
        ml.textCalls.length = 0;
        ml.imageTextCalls.length = 0;
        await find('format:pdf');
        await find('');

        expect(ml.textCalls).toEqual([]);
        expect(ml.imageTextCalls).toEqual([]);
    });

    it('answers from full text within the timeout when reverie-ml hangs, then stops asking for a while', async () => {
        const q = word('deed');
        const wordDoc = await seedDocument(db, { userId, name: 'w.pdf', ocrText: q });
        let requests = 0;

        const hung: typeof fetch = (_url, init) => {
            requests += 1;

            return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        };

        setSemanticSearch(createSemanticSearch(createMlClient('http://reverie-ml.test', 150, hung), CONFIG));

        const started = performance.now();
        const first = await find(q);

        expect(performance.now() - started).toBeLessThan(1500);
        expect(first.results.map((hit) => hit.result_type === 'document' && hit.document_id)).toEqual([wordDoc]);

        const asked = requests;
        const second = await find(q);

        expect(second.results).toHaveLength(1);
        expect(requests).toBe(asked);
    });

    it('lets a meaning match join other sorts in their own order, above the floor only', async () => {
        const q = word('holiday');
        const alpha = await seedDocument(db, { userId, name: 'a-alpha.pdf', ocrText: q });
        const mid = await seedDocument(db, { userId, name: 'b-meaning.pdf', ocrText: 'a trip' });
        const zulu = await seedDocument(db, { userId, name: 'z-zulu.pdf', ocrText: q });
        const below = await seedDocument(db, { userId, name: 'c-below.pdf', ocrText: 'a trip' });

        pinQuery(q);
        await embedText(mid, q, 0.8);
        await embedText(below, q, 0.4);

        expect(await idsOf(q, { sort_by: 'filename', sort_order: 'asc' })).toEqual([alpha, mid, zulu]);

        const response = await find(q, { sort_by: 'filename', sort_order: 'asc' });

        expect(response.total).toBe(3);
        expect(response.results.map((hit) => hit.result_type === 'document' && hit.match)).toEqual(['keywords', 'meaning', 'keywords']);
    });

    it('counts meaning matches in the facets and never puts them ahead of a matching folder', async () => {
        const q = word('taxes');
        const folder = await seedFolder(db, userId, q);
        const wordDoc = await seedDocument(db, { userId, name: 'w.pdf', ocrText: q });
        const meaning = await seedDocument(db, { userId, name: 'm.png', mime: 'image/png' });

        pinQuery(q);
        await embedText(wordDoc, q, 0.9);
        await embedImage(meaning, q, 0.9);

        const response = await find(q, { include_facets: true });
        const formats = Object.fromEntries((response.facets?.formats ?? []).map((item) => [item.name, item.count]));

        expect(formats).toEqual({ pdf: 1, png: 1 });
        expect(response.results.map((hit) => (hit.result_type === 'document' ? hit.document_id : hit.id))).toEqual([folder.id, wordDoc, meaning]);
        expect(response.total).toBe(3);
    });
});
