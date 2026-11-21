import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../settings/settings.service.js', () => ({ getSetting: vi.fn(async () => 30) }));
vi.mock('../services/upload.service', () => ({ getUploadService: () => ({ deleteDocumentFiles: vi.fn() }) }));

import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { getTrashService } from '../services/trash.service';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, type FakeMl } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { embedDocumentImage, embedDocumentText, type EmbedDeps } from './embedding.service';
import { MlUnavailableError } from './ml.client';

const THUMB = '/thumbs/sm.webp';

describeDb('embedding service', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let ml: FakeMl;
    let reads: string[];
    let deps: EmbedDeps;

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
        reads = [];
        deps = {
            db,
            ml,
            readFile: async (path) => {
                reads.push(path);

                return Buffer.from('thumbnail-bytes:' + path);
            },
        };
    });

    const textRows = (id: string) =>
        db
            .selectFrom('document_text_embeddings')
            .select(['chunk_index', 'content_hash', 'model', 'model_version'])
            .where('document_id', '=', id)
            .orderBy('chunk_index')
            .execute();
    const imageRows = (id: string) => db.selectFrom('document_image_embeddings').selectAll().where('document_id', '=', id).execute();

    async function imageDoc(name: string, folderId?: string): Promise<string> {
        const id = await seedDocument(db, { userId, name, mime: 'image/jpeg', folderId });

        await db
            .updateTable('documents')
            .set({ thumbnail_paths: { sm: THUMB, md: '/thumbs/md.webp', lg: '/thumbs/lg.webp' } })
            .where('id', '=', id)
            .execute();

        return id;
    }

    it('embeds the summary and OCR text as chunks, with model, version and hash on every row', async () => {
        const id = await seedDocument(db, { userId, name: 'a.pdf', ocrText: 'Vuokrasopimus alkaa 1.1.', summary: 'Rental agreement' });

        await expect(embedDocumentText(deps, id)).resolves.toBe('embedded');

        const rows = await textRows(id);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ chunk_index: 0, model: 'fake-text', model_version: 'rev-1' });
        expect(ml.textCalls[0]![0]).toBe('Rental agreement\n\nVuokrasopimus alkaa 1.1.');
    });

    it('does nothing the second time, and re-embeds once the summary lands', async () => {
        const id = await seedDocument(db, { userId, name: 'b.pdf', ocrText: 'Only OCR text so far' });

        expect(await embedDocumentText(deps, id)).toBe('embedded');
        expect(await embedDocumentText(deps, id)).toBe('unchanged');
        expect(ml.textCalls).toHaveLength(1);

        await db
            .insertInto('llm_results')
            .values({ document_id: id, summary: 'A summary', metadata: null, token_count: null, processing_type: null, duration_ms: null })
            .execute();

        expect(await embedDocumentText(deps, id)).toBe('embedded');
        expect(ml.textCalls[1]![0]).toBe('A summary\n\nOnly OCR text so far');
        expect(await textRows(id)).toHaveLength(1);
    });

    it('re-embeds when the model version changes, replacing the old rows in place', async () => {
        const id = await seedDocument(db, { userId, name: 'c.pdf', ocrText: 'text' });

        await embedDocumentText(deps, id);
        ml.setTextRevision('rev-2');

        expect(await embedDocumentText(deps, id)).toBe('embedded');
        expect((await textRows(id)).map((row) => row.model_version)).toEqual(['rev-2']);
    });

    it('splits long text into several chunks and replaces them all together', async () => {
        const id = await seedDocument(db, { userId, name: 'long.pdf', ocrText: 'Lause numero yksi. '.repeat(400) });

        await embedDocumentText(deps, id);

        expect((await textRows(id)).length).toBeGreaterThan(1);

        await db.updateTable('ocr_results').set({ raw_text: 'short now' }).where('document_id', '=', id).execute();
        await embedDocumentText(deps, id);

        expect(await textRows(id)).toHaveLength(1);
    });

    it('drops the chunks of a document that lost all its text, and skips one that has none', async () => {
        const id = await seedDocument(db, { userId, name: 'd.pdf', ocrText: 'text' });
        const empty = await seedDocument(db, { userId, name: 'empty.pdf' });

        await embedDocumentText(deps, id);
        await db.updateTable('ocr_results').set({ raw_text: '  ' }).where('document_id', '=', id).execute();

        expect(await embedDocumentText(deps, id)).toBe('no-text');
        expect(await textRows(id)).toHaveLength(0);
        expect(await embedDocumentText(deps, empty)).toBe('no-text');
    });

    it('embeds private documents too: embeddings never leave the machine', async () => {
        const locked = await seedFolder(db, userId, 'Locked', { isPrivate: true });
        const textId = await seedDocument(db, { userId, name: 'secret.pdf', ocrText: 'private text', folderId: locked.id });
        const photoId = await imageDoc('secret.jpg', locked.id);

        expect(await embedDocumentText(deps, textId)).toBe('embedded');
        expect(await embedDocumentImage(deps, photoId)).toBe('embedded');
        expect(await textRows(textId)).toHaveLength(1);
        expect(await imageRows(photoId)).toHaveLength(1);
    });

    it('embeds an image from its sm thumbnail, once per rendition', async () => {
        const id = await imageDoc('photo.jpg');

        expect(await embedDocumentImage(deps, id)).toBe('embedded');
        expect(reads).toEqual([THUMB]);
        expect(await embedDocumentImage(deps, id)).toBe('unchanged');
        expect(ml.imageCalls).toBe(1);

        const [row] = await imageRows(id);

        expect(row).toMatchObject({ model: 'fake-image', model_version: 'rev-1' });
    });

    it('skips documents that are not images or have no thumbnail yet', async () => {
        const pdf = await seedDocument(db, { userId, name: 'x.pdf', ocrText: 'text' });
        const noThumb = await seedDocument(db, { userId, name: 'raw.jpg', mime: 'image/jpeg' });

        expect(await embedDocumentImage(deps, pdf)).toBe('no-image');
        expect(await embedDocumentImage(deps, noThumb)).toBe('no-image');
        expect(await embedDocumentImage(deps, crypto.randomUUID())).toBe('no-document');
    });

    it('throws a retryable error while reverie-ml is down, and writes nothing', async () => {
        const id = await seedDocument(db, { userId, name: 'down.pdf', ocrText: 'text' });
        const photo = await imageDoc('down.jpg');

        ml.setDown(true);

        await expect(embedDocumentText(deps, id)).rejects.toBeInstanceOf(MlUnavailableError);
        await expect(embedDocumentImage(deps, photo)).rejects.toBeInstanceOf(MlUnavailableError);
        expect(await textRows(id)).toHaveLength(0);
        expect(await imageRows(photo)).toHaveLength(0);

        ml.setDown(false);

        expect(await embedDocumentText(deps, id)).toBe('embedded');
    });

    it('removes a document’s embeddings when the document is purged', async () => {
        const id = await seedDocument(db, { userId, name: 'purge.jpg', mime: 'image/jpeg', ocrText: 'text to purge' });

        await db
            .updateTable('documents')
            .set({ thumbnail_paths: { sm: THUMB, md: THUMB, lg: THUMB } })
            .where('id', '=', id)
            .execute();
        await embedDocumentText(deps, id);
        await embedDocumentImage(deps, id);
        await getTrashService().trashDocuments(userId, [id]);

        expect(await textRows(id)).toHaveLength(1);

        await getTrashService().purge(userId, { documentIds: [id] });

        expect(await textRows(id)).toHaveLength(0);
        expect(await imageRows(id)).toHaveLength(0);
    });

    it('uses real pgvector columns: the text index is HNSW with cosine distance', async () => {
        const { rows } = await sql<{ indexdef: string }>`
            SELECT indexdef FROM pg_indexes WHERE tablename IN ('document_text_embeddings', 'document_image_embeddings')
        `.execute(db);
        const defs = rows.map((row) => row.indexdef).join('\n');

        expect(defs.match(/USING hnsw/g)).toHaveLength(2);
        expect(defs).toContain('vector_cosine_ops');
    });
});
