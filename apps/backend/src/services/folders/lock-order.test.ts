import type { OrganizeTargetFolder } from '@reverie/shared';
import { expect, it, vi } from 'vitest';

vi.mock('../../db/kysely', async () => ({ db: (await import('../../testing/db-proxy.js')).dbProxy.db }));

import { countAdvisoryLockWaiters } from '../../testing/advisory-locks.js';
import { seedDocument, seedFolder } from '../../testing/seed.js';
import { describeDb, useWorld } from '../../testing/tool-world.js';
import { FolderLocks } from '../folder-locks.js';
import { executeOrganize } from '../organize.service.js';
import { getTrashService } from '../trash.service.js';
import { lockFolders } from './transaction.js';

describeDb('writes that touch documents and folders', () => {
    const ctx = useWorld();

    /**
     * Runs `work` while another folder write holds the user's folder lock, and has that write update the document
     * once `work` waits for the lock. Had `work` locked the row before asking for the lock, the two would deadlock.
     */
    async function runBesideFolderWrite(documentId: string, work: () => Promise<unknown>): Promise<void> {
        const { db, alice } = ctx.world();
        let running: Promise<unknown> = Promise.resolve();

        await db.transaction().execute(async (trx) => {
            await lockFolders(trx, alice);
            running = work();
            running.catch(() => undefined);
            await vi.waitFor(async () => expect(await countAdvisoryLockWaiters(trx)).toBe(1));
            await trx.updateTable('documents').set({ updated_at: new Date() }).where('id', '=', documentId).execute();
        });

        await running;
    }

    it('organize takes the folder lock before it moves a document', async () => {
        const { alice, db, folders } = ctx.world();
        const id = await seedDocument(db, { userId: alice, name: 'organized.pdf', folderId: folders.work.id });
        const move = (target_folder: OrganizeTargetFolder) => ({
            type: 'move' as const,
            document_ids: [id],
            document_previews: [],
            target_folder,
        });
        // The second move creates a folder after the first has already updated the document.
        const operations = [
            move({ id: folders.invoices.id, name: 'Invoices', is_new: false }),
            move({ name: 'Later', is_new: true, new_parent_name: 'Sorted' }),
        ];

        await runBesideFolderWrite(id, () => executeOrganize({ userId: alice, locks: new FolderLocks(new Map(), new Set(), false), operations }));

        const moved = await db
            .selectFrom('documents')
            .innerJoin('folders', 'folders.id', 'documents.folder_id')
            .select('folders.path')
            .where('documents.id', '=', id)
            .executeTakeFirstOrThrow();

        expect(moved.path).toBe('/Sorted/Later');
    });

    it('restoring documents takes the folder lock before it restores one', async () => {
        const { alice, db } = ctx.world();
        const closed = await seedFolder(db, alice, 'Trashed private', { isPrivate: true, deleted: true });
        const trashed = { userId: alice, deleted: true };
        const first = await seedDocument(db, { ...trashed, name: 'first.pdf', folderId: null });
        const second = await seedDocument(db, { ...trashed, name: 'second.pdf', folderId: closed.id });

        await runBesideFolderWrite(first, () => getTrashService().restoreDocuments(alice, [first, second]));

        const rows = await db.selectFrom('documents').select('deleted_at').where('id', 'in', [first, second]).execute();

        expect(rows.map((row) => row.deleted_at)).toEqual([null, null]);
    });
});
