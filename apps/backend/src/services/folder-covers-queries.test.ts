import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ recorder: { db: undefined as unknown, statements: [] as string[] } }));

vi.mock('../db/kysely', async () => {
    const { createRecordingDb } = await import('../testing/recording-db.js');
    const recording = createRecordingDb();
    h.recorder.db = recording.db;
    h.recorder.statements = recording.statements;

    return { db: recording.db };
});

import { loadFolderCovers } from './document-summary';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const folderIds = (count: number) => Array.from({ length: count }, (_, index) => '00000000-0000-4000-8000-' + String(index).padStart(12, '0'));

beforeEach(() => {
    h.recorder.statements.length = 0;
});

describe('loadFolderCovers', () => {
    it('runs the same statements for 2 folders as for 20', async () => {
        await loadFolderCovers(USER_ID, folderIds(2));

        const few = [...h.recorder.statements];

        h.recorder.statements.length = 0;
        await loadFolderCovers(USER_ID, folderIds(20));

        expect(few).toHaveLength(3);
        expect(h.recorder.statements).toHaveLength(3);
    });

    it('runs nothing for no folders', async () => {
        expect((await loadFolderCovers(USER_ID, [])).size).toBe(0);
        expect(h.recorder.statements).toHaveLength(0);
    });

    it('keeps trashed documents out of every statement and scopes them to the user', async () => {
        await loadFolderCovers(USER_ID, folderIds(2));

        for (const sql of h.recorder.statements) {
            expect(sql).toContain('"deleted_at" is null');
            expect(sql).toMatch(/"user_id" = \$\d+/);
        }
    });
});
