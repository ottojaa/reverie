import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ recorder: { db: undefined as unknown, statements: [] as string[] } }));

vi.mock('../db/kysely', async () => {
    const { createRecordingDb } = await import('../testing/recording-db.js');
    const recording = createRecordingDb();
    h.recorder.db = recording.db;
    h.recorder.statements = recording.statements;

    return { db: recording.db };
});

import { generateFacets } from '../search/facets';
import { parseQuery } from '../search/query-parser';
import { countDocuments, findDocumentsForOrganize, getCategoryOverview, getFolderOverview, search, suggest } from '../search/search.service';
import { getFolderService } from './folder.service';
import { getUploadService } from './upload.service';

/**
 * Sweep: runs the real read paths against a db that records SQL, and checks that every statement
 * touching documents or folders excludes trashed rows. A new query that forgets excludeTrashed
 * shows up here as a statement without `deleted_at`.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';

/** The privacy lookup deliberately ignores trash: a trashed item in a private folder stays locked. */
function isPrivateFolderLookup(sql: string): boolean {
    return /^select "id" from "folders" where "user_id" = \$1 and ("is_private" = \$2|"parent_id" in)/.test(sql);
}

function touchesTrashableTable(sql: string): boolean {
    return /(from|join|update|into) "(documents|folders)"/.test(sql);
}

function trashableStatements(): string[] {
    return h.recorder.statements.filter((sql) => touchesTrashableTable(sql) && !isPrivateFolderLookup(sql));
}

beforeEach(() => {
    h.recorder.statements.length = 0;
});

describe('trashed rows are excluded from every read path', () => {
    it('document and folder getters', async () => {
        const uploadService = getUploadService();
        const folderService = getFolderService();

        await uploadService.getDocument('d', USER_ID);
        await uploadService.getDocumentsInFolder(USER_ID, FOLDER_ID);
        await uploadService.getDocumentsInFolder(USER_ID, null);
        await uploadService.getFilenamesInFolder(USER_ID, FOLDER_ID);
        await folderService.getFolder(FOLDER_ID, USER_ID);
        await folderService.getFolderByPath('/A/B', USER_ID);
        await folderService.listChildren(null, USER_ID);
        await folderService.getFolderWithCount(FOLDER_ID, USER_ID);

        const statements = trashableStatements();

        expect(statements.length).toBeGreaterThan(0);

        for (const sql of statements) expect(sql).toContain('deleted_at');
    });

    it('folder writes that check for name clashes', async () => {
        const folderService = getFolderService();

        await folderService.createFolder(USER_ID, 'Taxes', undefined, undefined, undefined, 'collection').catch(() => undefined);
        await folderService.deleteEmptyFolder(FOLDER_ID, USER_ID).catch(() => undefined);

        for (const sql of trashableStatements().filter((s) => s.startsWith('select'))) expect(sql).toContain('deleted_at');
    });

    it('search, counts, facets, suggestions, overviews and organize retrieval', async () => {
        const parsed = parseQuery('beach');

        await search({ q: 'beach', limit: 10, offset: 0, sort_by: 'relevance', sort_order: 'desc', include_facets: true }, { userId: USER_ID });
        await search({ q: 'type:pdf', limit: 10, offset: 0, sort_by: 'uploaded', sort_order: 'desc', include_facets: true }, { userId: USER_ID });
        await countDocuments(parsed, USER_ID, []);
        await generateFacets(parsed, USER_ID, []);
        await getCategoryOverview(USER_ID);
        await getFolderOverview(USER_ID);
        await findDocumentsForOrganize('beach', { userId: USER_ID });

        for (const type of ['filename', 'folder', 'tag', 'entity', 'category', 'location'] as const) {
            await suggest({ type, q: 'a', limit: 5 }, USER_ID);
        }

        const statements = trashableStatements();

        expect(statements.length).toBeGreaterThan(20);

        const missing = statements.filter((sql) => !sql.includes('deleted_at'));

        expect(missing).toEqual([]);
    });

    it('the folder-hit document count ignores trashed documents', async () => {
        await search({ q: 'beach', limit: 10, offset: 0, sort_by: 'relevance', sort_order: 'desc', include_facets: false }, { userId: USER_ID });

        const folderHit = h.recorder.statements.find((sql) => sql.includes('"dd"'));

        expect(folderHit).toContain('"dd"."deleted_at" is null');
    });
});
