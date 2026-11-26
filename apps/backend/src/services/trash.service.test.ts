import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingDb } from '../testing/recording-db.js';

const h = vi.hoisted(() => ({
    recording: undefined as unknown as RecordingDb,
    deleteDocumentFiles: vi.fn(),
}));

vi.mock('../db/kysely', async () => {
    const { createRecordingDb } = await import('../testing/recording-db.js');
    h.recording = createRecordingDb();

    return { db: h.recording.db };
});
vi.mock('../settings/settings.service.js', () => ({ getSetting: vi.fn(async () => 30) }));
vi.mock('./upload.service', () => ({ getUploadService: () => ({ deleteDocumentFiles: h.deleteDocumentFiles }) }));

import { getTrashService } from './trash.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 24 * 60 * 60 * 1000;

const trashedFolder = { id: 'folder-1', user_id: USER_ID, parent_id: null, name: 'Taxes', path: '/Taxes', sort_order: 0, deleted_at: new Date('2026-01-01') };
const isFolderTreeRead = (sql: string) => sql === 'select * from "folders" where "user_id" = $1';

/** Answers as a database holding one trashed folder would. */
function answerWithTrashedFolder(sql: string): unknown[] | undefined {
    if (sql.startsWith('select distinct "user_id" from "folders"')) return [{ user_id: USER_ID }];

    return isFolderTreeRead(sql) || sql.startsWith('select * from "folders" where "id"') ? [trashedFolder] : undefined;
}

const trashedDocs = [
    { id: 'doc-1', user_id: USER_ID },
    { id: 'doc-2', user_id: USER_ID },
];

function findStatement(prefix: string): number {
    return h.recording.statements.findIndex((sql) => sql.startsWith(prefix));
}

beforeEach(() => {
    h.recording.statements.length = 0;
    h.recording.parameters.length = 0;
    h.recording.respond = undefined;
    h.deleteDocumentFiles.mockReset();
});

describe('purge', () => {
    it('only deletes rows that are trashed and older than the retention cutoff, then their files', async () => {
        const now = new Date('2026-11-19T12:00:00Z');

        h.recording.respond = (sql) => {
            if (sql.startsWith('delete from "documents"') && sql.includes('"deleted_at" <')) return trashedDocs;

            return answerWithTrashedFolder(sql);
        };

        const result = await getTrashService().purgeExpired(now);

        const index = findStatement('delete from "documents"');
        const sql = h.recording.statements[index]!;

        expect(sql).toContain('"deleted_at" is not null');
        expect(sql).toContain('"deleted_at" < $1');
        expect(h.recording.parameters[index]![0]).toEqual(new Date(now.getTime() - 30 * DAY_MS));
        expect(h.recording.statements.some((s) => s.startsWith('delete from "folders"') && s.includes('"deleted_at" is not null'))).toBe(true);
        expect(h.deleteDocumentFiles).toHaveBeenCalledTimes(2);
        expect(h.deleteDocumentFiles).toHaveBeenCalledWith(trashedDocs[0], USER_ID);
        expect(h.deleteDocumentFiles).toHaveBeenCalledWith(trashedDocs[1], USER_ID);
        expect(result.documents).toBe(2);
    });

    it('"Delete forever" and "Empty trash" never touch live rows and apply no cutoff', async () => {
        const service = getTrashService();

        h.recording.respond = answerWithTrashedFolder;

        await service.purge(USER_ID, { documentIds: ['doc-1'], folderIds: ['folder-1'] });
        await service.emptyTrash(USER_ID);

        const deletes = h.recording.statements.filter((sql) => sql.startsWith('delete from "documents"') || sql.startsWith('delete from "folders"'));

        // Each of the two deletes the selected documents, then the folder's documents, then the folder.
        expect(deletes).toHaveLength(6);

        for (const sql of deletes) {
            expect(sql).toContain('"deleted_at" is not null');
            expect(sql).not.toContain('"deleted_at" <');
        }
    });

    it('an empty selection deletes nothing', async () => {
        await getTrashService().purge(USER_ID, {});

        expect(h.recording.statements).toEqual([]);
    });
});

describe('restore', () => {
    it('restores folders before documents, so a document returns to a folder that was trashed after it', async () => {
        h.recording.respond = answerWithTrashedFolder;

        const result = await getTrashService().restore(USER_ID, { folderIds: ['folder-1'], documentIds: ['doc-1'] });
        const selected = h.recording.statements.findIndex((sql) => sql.startsWith('select * from "documents"'));

        expect(result).toEqual({ documents: 0, folders: 1 });
        expect(findStatement('update "folders"')).toBeGreaterThanOrEqual(0);
        expect(findStatement('update "folders"')).toBeLessThan(selected);
    });
});
