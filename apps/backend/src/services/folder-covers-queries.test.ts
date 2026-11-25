import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ recorder: { db: undefined as unknown, statements: [] as string[] } }));

vi.mock('../db/kysely', async () => {
    const { createRecordingDb } = await import('../testing/recording-db.js');
    const recording = createRecordingDb();
    h.recorder.db = recording.db;
    h.recorder.statements = recording.statements;

    return { db: recording.db };
});

import type { Folder } from '../db/schema';
import { FolderLocks } from './folder-locks';
import { loadFolderRollups } from './folders/rollup';
import { toFolderTree } from './folders/snapshot';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const folderId = (index: number) => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
const NO_LOCKS = new FolderLocks(new Map(), new Set(), true);

/** A chain `count` folders deep, so that the number of folders and the depth grow together. */
function toChain(count: number) {
    return toFolderTree(
        Array.from({ length: count }, (_, index) => ({
            id: folderId(index),
            parent_id: index === 0 ? null : folderId(index - 1),
            name: 'f' + index,
            sort_order: 0,
            is_private: false,
            deleted_at: null,
        })) as Folder[],
    );
}

function rollUp(count: number) {
    return loadFolderRollups(USER_ID, toChain(count), count === 0 ? [] : [folderId(0)], NO_LOCKS);
}

beforeEach(() => {
    h.recorder.statements.length = 0;
});

describe('loadFolderRollups', () => {
    it('runs the same statements for 2 folders as for 20', async () => {
        await rollUp(2);

        const few = [...h.recorder.statements];

        h.recorder.statements.length = 0;

        expect((await rollUp(20)).size).toBe(20);
        expect(few).toHaveLength(3);
        expect(h.recorder.statements).toHaveLength(3);
    });

    it('runs nothing for no folders', async () => {
        expect((await rollUp(0)).size).toBe(0);
        expect(h.recorder.statements).toHaveLength(0);
    });

    it('keeps trashed documents out of every statement and scopes them to the user', async () => {
        await rollUp(2);

        for (const sql of h.recorder.statements) {
            expect(sql).toContain('"deleted_at" is null');
            expect(sql).toMatch(/"user_id" = \$\d+/);
        }
    });
});
