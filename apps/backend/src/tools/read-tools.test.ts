import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { describeDb, HIDDEN_DOCS, refusal, run, useWorld, type World } from '../testing/tool-world';

const ctx = useWorld();
// The world is built in beforeAll; these read it lazily so the tests below can use plain `w` and `started`.
const w = new Proxy({} as World, { get: (_target, key) => ctx.world()[key as keyof World] });
const started = {
    get port() {
        return ctx.port();
    },
};

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const visibleDocIds = () =>
    ['invoice', 'notes', 'loose', 'photo', 'gpsOnly', 'screenshot', 'emptyExif', 'captioned'].map((key) => w.docs[key as keyof World['docs']]);
const PLANTED = ['PLANTEDCAPTION', 'PLANTEDOCR', 'PLANTEDENTITY', 'CAPTIONWORD', 'CAPTIONOCR'];

describeDb('search_documents', () => {
    it('finds documents by free text and returns compact rows', async () => {
        const out = await run(w.alice, 'search_documents', { query: 'invoice' });

        expect(ids(out.rows)).toContain(w.docs.invoice);
        expect(out.rows[0]).toMatchObject({
            id: w.docs.invoice,
            filename: 'invoice-acme.pdf',
            type: 'receipt',
            date: '2024-03-10',
            folder: '/Work/Invoices',
            tags: ['acme', 'tax'],
        });
        expect(Object.keys(out.rows[0]).sort()).toEqual(['date', 'filename', 'folder', 'id', 'tags', 'type']);
    });

    it('lists the whole visible library for an empty query, and the selection holds every match', async () => {
        const out = await run(w.alice, 'search_documents', { query: '', limit: 2 });

        expect(out.total).toBe(visibleDocIds().length);
        expect(out.rows).toHaveLength(2);
        expect(out.selection_id).toEqual(expect.any(String));
        expect(out.truncated).toBe(false);
    });

    it('applies the structured filters: type, category, tags, date, location, folder', async () => {
        const byTag = await run(w.alice, 'search_documents', { tags: ['tax'] });
        const byCategory = await run(w.alice, 'search_documents', { categories: ['receipt'] });
        const byDate = await run(w.alice, 'search_documents', { date: '2023' });
        const byFolder = await run(w.alice, 'search_documents', { folder: '/Work/Invoices' });
        const byFolderId = await run(w.alice, 'search_documents', { folder_id: w.folders.work.id });
        const byLocation = await run(w.alice, 'search_documents', { location: 'Helsinki' });
        const byType = await run(w.alice, 'search_documents', { types: ['screenshot'] });

        expect(ids(byTag.rows)).toEqual([w.docs.invoice]);
        expect(ids(byCategory.rows)).toEqual([w.docs.invoice]);
        expect(ids(byDate.rows)).toEqual([w.docs.notes]);
        expect(ids(byFolder.rows)).toEqual([w.docs.invoice]);
        expect(ids(byFolderId.rows).sort()).toEqual([w.docs.notes, w.docs.photo].sort());
        expect(ids(byLocation.rows)).toEqual([w.docs.photo]);
        expect(ids(byType.rows)).toEqual([w.docs.screenshot]);
    });

    it('understands the q-DSL inside the query', async () => {
        const out = await run(w.alice, 'search_documents', { query: 'tag:tax category:receipt' });

        expect(ids(out.rows)).toEqual([w.docs.invoice]);
    });

    it('pages with limit and offset and returns no selection when nothing matches', async () => {
        const first = await run(w.alice, 'search_documents', { query: '', limit: 3 });
        const second = await run(w.alice, 'search_documents', { query: '', limit: 3, offset: 3 });
        const none = await run(w.alice, 'search_documents', { query: 'nonexistentwordxyz' });

        expect(first.rows).toHaveLength(3);
        expect(ids(second.rows).filter((id) => ids(first.rows).includes(id))).toEqual([]);
        expect(none).toMatchObject({ total: 0, rows: [], selection_id: null });
    });

    it('refuses an invalid date filter and invalid input with a clear message', async () => {
        expect(await refusal(w.alice, 'search_documents', { date: 'not-a-date' })).toMatch(/Invalid date filter/);
        expect(await refusal(w.alice, 'search_documents', { limit: 1000 })).toMatch(/Invalid input: limit/);
    });
});

describeDb('locked and trashed items are invisible to every read tool', () => {
    it('search_documents: never returns them, by text, by tag, or by listing', async () => {
        for (const input of [
            { query: '' },
            { query: 'LOCKEDWORD' },
            { query: 'TRASHEDWORD' },
            { tags: ['lockedtag'] },
            { tags: ['trashedtag'] },
            { query: 'in:content LOCKEDWORD' },
            { folder: '/Vault' },
            { folder: '/Archive/Hidden' },
        ]) {
            const out = await run(w.alice, 'search_documents', input);
            const found = new Set(ids(out.rows));

            for (const key of HIDDEN_DOCS) expect(found.has(w.docs[key]), key + ' via ' + JSON.stringify(input)).toBe(false);
        }
    });

    it('search_documents: the selection holds visible ids only', async () => {
        const out = await run(w.alice, 'search_documents', { query: '' });
        const redisKey = 'tool-selection:' + w.alice + ':' + out.selection_id;
        const stored = JSON.parse((await started.port.get(redisKey)) as string) as string[];

        expect(stored.sort()).toEqual(visibleDocIds().sort());
    });

    it('get_document: refuses them with the same text as an unknown id', async () => {
        const unknown = await refusal(w.alice, 'get_document', { document_id: '00000000-0000-4000-8000-000000000000' });

        for (const key of HIDDEN_DOCS) {
            const message = await refusal(w.alice, 'get_document', { document_id: w.docs[key] });

            expect(message.replace(w.docs[key], 'ID'), key).toBe(unknown.replace('00000000-0000-4000-8000-000000000000', 'ID'));
        }
    });

    it('list_folders: omits locked and trashed folders and counts only visible documents', async () => {
        const out = await run(w.alice, 'list_folders');
        const text = JSON.stringify(out);

        for (const name of ['Vault', 'Inner', 'Hidden', 'Bin']) expect(text).not.toContain('"' + name + '"');

        const archive = out.collections.find((c: { name: string }) => c.name === 'Archive');

        expect(archive.folders).toEqual([]);
        expect(archive.documents).toBe(0);
        expect(out.unfiled_documents).toBe(5);
    });

    it('list_folder_contents: refuses locked and trashed folders and lists no hidden document', async () => {
        const message = await refusal(w.alice, 'list_folder_contents', { folder_id: '00000000-0000-4000-8000-000000000000' });

        for (const key of ['vault', 'vaultInner', 'lockedFolder', 'bin'] as const) {
            expect((await refusal(w.alice, 'list_folder_contents', { folder_id: w.folders[key].id })).replace(w.folders[key].id, 'ID')).toBe(
                message.replace('00000000-0000-4000-8000-000000000000', 'ID'),
            );
        }

        const root = await run(w.alice, 'list_folder_contents', {});
        const archive = await run(w.alice, 'list_folder_contents', { folder_id: w.folders.secretParent.id });

        expect(JSON.stringify(root)).not.toMatch(/Vault|Hidden|Bin|locked|trashed/i);
        expect(archive.folders).toEqual([]);
        expect(archive.total_documents).toBe(0);
    });

    it('get_library_overview: counts only visible documents', async () => {
        const out = await run(w.alice, 'get_library_overview');

        expect(out.total).toBe(visibleDocIds().length);
        expect(JSON.stringify(out)).not.toMatch(/Vault|Hidden|Bin/);
    });
});

describeDb('another user', () => {
    it('never sees the first user’s documents or folders, and vice versa', async () => {
        const bobSearch = await run(w.bob, 'search_documents', { query: '' });
        const aliceSearch = await run(w.alice, 'search_documents', { query: 'BOBWORD' });
        const bobFolders = await run(w.bob, 'list_folders');

        expect(ids(bobSearch.rows)).toEqual([w.docs.bobs]);
        expect(aliceSearch.rows).toEqual([]);
        expect(bobFolders.collections.map((c: { name: string }) => c.name)).toEqual(['BobWork']);
        await refusal(w.bob, 'get_document', { document_id: w.docs.invoice });
        await refusal(w.alice, 'get_document', { document_id: w.docs.bobs });
    });
});

describeDb('get_document', () => {
    it('returns summary, entities, dates, tags and a page of OCR text', async () => {
        const out = await run(w.alice, 'get_document', { document_id: w.docs.invoice });

        expect(out).toMatchObject({
            filename: 'invoice-acme.pdf',
            type: 'receipt',
            date: '2024-03-10',
            folder: '/Work/Invoices',
            tags: ['acme', 'tax'],
            summary: 'Invoice from Acme Oy for consulting',
            entities: [{ type: 'other', name: 'Acme Oy' }],
        });
        expect(out.text).toEqual({ content: 'Invoice total 120 EUR for Acme services', offset: 0, total_length: 39, next_offset: null });
    });

    it('pages the OCR text by offset', async () => {
        const first = await run(w.alice, 'get_document', { document_id: w.docs.invoice, text_length: 10 });
        const second = await run(w.alice, 'get_document', { document_id: w.docs.invoice, text_offset: first.text.next_offset, text_length: 100 });

        expect(first.text).toMatchObject({ content: 'Invoice to', offset: 0, next_offset: 10 });
        expect(first.text.content + second.text.content).toBe('Invoice total 120 EUR for Acme services');
        expect(second.text.next_offset).toBeNull();
    });
});

describeDb('photos: details only', () => {
    const photoKeys = ['photo', 'gpsOnly', 'captioned'] as const;

    it('get_document returns filename, date, place, tags and nothing derived from the picture', async () => {
        const out = await run(w.alice, 'get_document', { document_id: w.docs.photo });

        expect(out).toMatchObject({
            filename: 'IMG_0001.jpg',
            type: 'photo',
            date: '2022-07-15',
            place: 'Helsinki, Finland',
            tags: ['holiday'],
            content_withheld: true,
        });

        for (const key of ['summary', 'entities', 'text', 'title', 'thumbnail', 'thumbnail_paths', 'thumbnail_urls', 'blurhash', 'url', 'image'])
            expect(out).not.toHaveProperty(key);

        for (const word of PLANTED) expect(JSON.stringify(out)).not.toContain(word);
    });

    it('hides the model’s reading of the date: a photo shows its capture date only', async () => {
        const gps = await run(w.alice, 'get_document', { document_id: w.docs.gpsOnly });

        expect(gps.date).toBeNull();
        expect(JSON.stringify(await run(w.alice, 'get_document', { document_id: w.docs.photo }))).not.toContain('2020-01-01');
    });

    it('no read tool output for a photo contains planted summary, entity or OCR text', async () => {
        const outputs = [
            await run(w.alice, 'search_documents', { query: '' }),
            await run(w.alice, 'search_documents', { types: ['photo'] }),
            await run(w.alice, 'list_folder_contents', { folder_id: w.folders.work.id }),
            await run(w.alice, 'list_folder_contents', {}),
            await run(w.alice, 'list_folders'),
            await run(w.alice, 'get_library_overview'),
            ...(await Promise.all(photoKeys.map((key) => run(w.alice, 'get_document', { document_id: w.docs[key] })))),
        ];

        for (const out of outputs) for (const word of PLANTED) expect(JSON.stringify(out)).not.toContain(word);
    });

    it('rows carry only id, filename, type, date, folder, place and tags', async () => {
        const out = await run(w.alice, 'search_documents', { query: '' });
        const rows = out.rows.filter((row: { id: string }) => photoKeys.some((key) => w.docs[key] === row.id));

        expect(rows).toHaveLength(3);

        for (const row of rows) for (const key of Object.keys(row)) expect(['id', 'filename', 'type', 'date', 'folder', 'place', 'tags']).toContain(key);
    });

    it('a screenshot without EXIF is not a photo: its content is returned', async () => {
        const out = await run(w.alice, 'get_document', { document_id: w.docs.screenshot });

        expect(out).toMatchObject({ type: 'screenshot', summary: 'A dashboard SCREENSHOTTEXT' });
        expect(out.text.content).toContain('SCREENSHOTTEXT');
        expect(out).not.toHaveProperty('content_withheld');
        expect((await run(w.alice, 'search_documents', { types: ['photo'] })).rows.map((r: { filename: string }) => r.filename)).not.toContain(
            'Screenshot 1.png',
        );
    });

    it('an image with an empty EXIF row is not a photo either (scan keeps its content)', async () => {
        const out = await run(w.alice, 'get_document', { document_id: w.docs.emptyExif });

        expect(out.summary).toContain('SCANTEXT');
        expect(out.type).toBe('other');
    });

    it('search cannot confirm hidden content: no match on summary, entity or OCR words of a photo', async () => {
        for (const query of [
            'PLANTEDCAPTION',
            'PLANTEDOCR',
            'PLANTEDENTITY',
            'CAPTIONWORD',
            'CAPTIONOCR',
            'content:PLANTEDOCR',
            'entity:PLANTEDENTITY',
            'in:summary PLANTEDCAPTION',
            'sunset',
        ]) {
            const out = await run(w.alice, 'search_documents', { query });

            for (const key of [...photoKeys]) expect(ids(out.rows), query).not.toContain(w.docs[key]);
        }
    });

    it('search still finds a photo by filename, place and tag', async () => {
        expect(ids((await run(w.alice, 'search_documents', { query: 'IMG' })).rows)).toContain(w.docs.photo);
        expect(ids((await run(w.alice, 'search_documents', { query: 'Helsinki' })).rows)).toContain(w.docs.photo);
        expect(ids((await run(w.alice, 'search_documents', { query: 'holiday' })).rows)).toContain(w.docs.photo);
    });

    it('overview groups years by capture date for photos, not the model’s date', async () => {
        const out = await run(w.alice, 'get_library_overview');
        const years = Object.fromEntries(out.by_year.map((entry: { name: string; count: number }) => [entry.name, entry.count]));

        expect(years['2020']).toBeUndefined();
        expect(years['2022']).toBe(1);
    });
});

describeDb('list_folders, list_folder_contents and get_library_overview', () => {
    it('list_folders returns the collection tree with counts', async () => {
        const out = await run(w.alice, 'list_folders');
        const work = out.collections.find((c: { name: string }) => c.name === 'Work');

        expect(work).toMatchObject({ path: '/Work', type: 'collection', documents: 2 });
        expect(work.folders).toMatchObject([{ name: 'Invoices', path: '/Work/Invoices', documents: 1 }]);
        expect(out.collections.map((c: { name: string }) => c.name).sort()).toEqual(['Archive', 'Empty', 'Work']);
    });

    it('list_folder_contents lists child folders and pages documents', async () => {
        const work = await run(w.alice, 'list_folder_contents', { folder_id: w.folders.work.id, limit: 1 });
        const next = await run(w.alice, 'list_folder_contents', { folder_id: w.folders.work.id, limit: 1, offset: 1 });
        const root = await run(w.alice, 'list_folder_contents', {});

        expect(work.folders.map((f: { name: string }) => f.name)).toEqual(['Invoices']);
        expect(work.total_documents).toBe(2);
        expect(work.documents).toHaveLength(1);
        expect(ids(work.documents).concat(ids(next.documents)).sort()).toEqual([w.docs.notes, w.docs.photo].sort());
        expect(root.folder).toBeNull();
        expect(root.folders.map((f: { name: string }) => f.name).sort()).toEqual(['Archive', 'Empty', 'Work']);
        expect(root.total_documents).toBe(5);
    });

    it('get_library_overview counts by category, year, place and folder', async () => {
        const out = await run(w.alice, 'get_library_overview');
        const asMap = (entries: { name: string; count: number }[]) => Object.fromEntries(entries.map((entry) => [entry.name, entry.count]));

        expect(out.total).toBe(8);
        expect(asMap(out.by_category)).toMatchObject({ receipt: 1, screenshot: 1, other: 3, photo: 3 });
        expect(asMap(out.by_year)).toMatchObject({ '2024': 2, '2023': 1, '2022': 1 });
        expect(asMap(out.by_place)).toMatchObject({ 'Helsinki, Finland': 1, 'Tampere, Finland': 1 });
        expect(asMap(out.by_folder)).toMatchObject({ '/Work': 2, '/Work/Invoices': 1 });
    });
});
