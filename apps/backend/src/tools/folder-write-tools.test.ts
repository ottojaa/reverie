import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedDocument, seedFolder } from '../testing/seed';
import { describeDb, refusal, run } from '../testing/tool-world';
import { loadAudit, snapshotLibrary } from '../testing/write-helpers';
import { trashFolder } from '../services/trash-folders';
import { useWriteFixtures } from '../testing/write-fixtures';

const { alice, db, unique, newFolder, newSubfolder, newDoc } = useWriteFixtures();

describeDb('move_documents', () => {
    it('moves documents into a folder and logs the old folders', async () => {
        const from = await newSubfolder();
        const to = await newSubfolder();
        const id = await newDoc({ folderId: from.id });
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });
        const row = await db().selectFrom('documents').select('folder_id').where('id', '=', id).executeTakeFirstOrThrow();
        const [entry] = (await loadAudit(db(), alice())).filter((e) => e.id === out.audit_id);

        expect(row.folder_id).toBe(to.id);
        expect(out).toMatchObject({ applied: true, moved: 1, already_there: 0 });
        expect(entry!.state_before).toEqual({ moves: [{ id, folder_id: from.id }] });
    });

    it('dry_run changes nothing', async () => {
        const to = await newSubfolder();
        const id = await newDoc();
        const before = await snapshotLibrary(db());
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id, dry_run: true });

        expect(out).toMatchObject({ dry_run: true, applied: false, moved: 1 });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('refuses a collection as target and a filename clash, logging nothing', async () => {
        const collection = await newFolder();
        const folder = await newFolder(unique('Sub'), collection);
        const existing = await newDoc({ folderId: folder.id, name: 'same.pdf' });
        const clash = await newDoc({ name: 'same.pdf' });
        const before = await loadAudit(db(), alice());

        expect(existing).toBeDefined();
        expect(await refusal(alice(), 'move_documents', { document_ids: [clash], folder_id: collection.id })).toMatch(/only be moved into a folder/);
        expect(await refusal(alice(), 'move_documents', { document_ids: [clash], folder_id: folder.id })).toMatch(/would clash/);
        expect(await loadAudit(db(), alice())).toEqual(before);
    });

    it('refuses a move that would put a second document of the same name next to one already there', async () => {
        const target = await newSubfolder();
        const elsewhere = await newSubfolder();
        const resident = await newDoc({ folderId: target.id, name: 'twin.pdf' });
        const newcomer = await newDoc({ folderId: elsewhere.id, name: 'twin.pdf' });

        expect(await refusal(alice(), 'move_documents', { document_ids: [resident, newcomer], folder_id: target.id })).toMatch(/would clash/);
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', newcomer).executeTakeFirstOrThrow()).folder_id).toBe(elsewhere.id);
    });

    it('undo moves them back; refuses after they moved again', async () => {
        const from = await newSubfolder();
        const to = await newSubfolder();
        const elsewhere = await newSubfolder();
        const a = await newDoc({ folderId: from.id });
        const b = await newDoc({ folderId: from.id });
        const out = await run(alice(), 'move_documents', { document_ids: [a, b], folder_id: to.id });

        await run(alice(), 'undo_write', { audit_id: out.audit_id });
        expect((await db().selectFrom('documents').select('folder_id').where('id', 'in', [a, b]).execute()).map((r) => r.folder_id)).toEqual([
            from.id,
            from.id,
        ]);

        const again = await run(alice(), 'move_documents', { document_ids: [a, b], folder_id: to.id });

        await run(alice(), 'move_documents', { document_ids: [a], folder_id: elsewhere.id });
        expect(await refusal(alice(), 'undo_write', { audit_id: again.audit_id })).toMatch(
            /Cannot undo: 1 document\(s\) are no longer where the move put them/,
        );
    });

    it('undo refuses when the folder the documents came from has since been trashed', async () => {
        const from = await newSubfolder();
        const to = await newSubfolder();
        const id = await newDoc({ folderId: from.id });
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });

        await db().updateTable('folders').set({ deleted_at: new Date() }).where('id', '=', from.id).execute();
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Cannot undo: the folder the documents came from is no longer available');
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', id).executeTakeFirstOrThrow()).folder_id).toBe(to.id);
    });

    it('undo refuses when the folder the documents were moved into has since been trashed', async () => {
        const from = await newSubfolder();
        const to = await newSubfolder();
        const id = await newDoc({ folderId: from.id });
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });

        // Trashing a folder drops its live documents to the root, which is where this one now is.
        await trashFolder(alice(), to.id);
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/^Cannot undo: 1 document\(s\) are no longer where the move put them/);
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', id).executeTakeFirstOrThrow()).folder_id).toBeNull();
    });

    it('undo puts a document back at the top of a collection', async () => {
        const collection = await newFolder();
        const to = await newFolder(unique('Sub'), await newFolder());
        const id = await newDoc({ folderId: collection.id });
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });

        await run(alice(), 'undo_write', { audit_id: out.audit_id });
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', id).executeTakeFirstOrThrow()).folder_id).toBe(collection.id);
    });
});

describeDb('create_folder', () => {
    it('creates a collection and a folder inside it, and logs both', async () => {
        const name = unique('Coll');
        const collection = await run(alice(), 'create_folder', { name });
        const folder = await run(alice(), 'create_folder', {
            name: 'Inside',
            parent_id: (
                await db()
                    .selectFrom('folders')
                    .select('id')
                    .where('path', '=', '/' + name)
                    .where('user_id', '=', alice())
                    .executeTakeFirstOrThrow()
            ).id,
        });

        expect(collection).toMatchObject({ applied: true, path: '/' + name, type: 'collection' });
        expect(folder).toMatchObject({ applied: true, path: '/' + name + '/Inside', type: 'folder' });
        expect((await run(alice(), 'list_folders')).collections.find((c: { name: string }) => c.name === name).folders).toHaveLength(1);
    });

    it('dry_run changes nothing', async () => {
        const before = await snapshotLibrary(db());
        const out = await run(alice(), 'create_folder', { name: unique('Dry'), dry_run: true });

        expect(out).toMatchObject({ dry_run: true, applied: false });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('refuses a name already taken, without saying whether the holder is locked', async () => {
        const taken = await refusal(alice(), 'create_folder', { name: 'Work' });
        const locked = await refusal(alice(), 'create_folder', { name: 'Vault' });

        expect(taken).toMatch(/not available/);
        expect(locked.replace('Vault', 'Work')).toBe(taken);
    });

    it('undo of an empty folder sends it to the trash instead of deleting it', async () => {
        const name = unique('Empty');
        const out = await run(alice(), 'create_folder', { name });
        const undone = await run(alice(), 'undo_write', { audit_id: out.audit_id });
        const row = await db()
            .selectFrom('folders')
            .select(['id', 'deleted_at'])
            .where('path', '=', '/' + name)
            .where('user_id', '=', alice())
            .executeTakeFirst();

        expect(undone).toMatchObject({ applied: true, folder_trashed: '/' + name });
        expect(row?.deleted_at).toBeInstanceOf(Date);
    });

    it('undo refuses a folder that now holds a document, and one that holds a child folder', async () => {
        const holdsDoc = await run(alice(), 'create_folder', { name: unique('Full') });
        const docFolder = await db()
            .selectFrom('folders')
            .select('id')
            .where('path', '=', holdsDoc.path)
            .where('user_id', '=', alice())
            .executeTakeFirstOrThrow();
        const doc = await newDoc();

        await db().updateTable('documents').set({ folder_id: docFolder.id }).where('id', '=', doc).execute();
        expect(await refusal(alice(), 'undo_write', { audit_id: holdsDoc.audit_id })).toBe('Cannot undo: the folder is not empty');

        const holdsChild = await run(alice(), 'create_folder', { name: unique('Parent') });
        const parent = await db()
            .selectFrom('folders')
            .select('id')
            .where('path', '=', holdsChild.path)
            .where('user_id', '=', alice())
            .executeTakeFirstOrThrow();

        await run(alice(), 'create_folder', { name: 'Child', parent_id: parent.id });
        expect(await refusal(alice(), 'undo_write', { audit_id: holdsChild.audit_id })).toBe('Cannot undo: the folder is not empty');
        expect((await db().selectFrom('folders').select('deleted_at').where('id', '=', docFolder.id).executeTakeFirstOrThrow()).deleted_at).toBeNull();
    });

    it('counts a private subfolder and its document as content, so undo cannot drop them to the root', async () => {
        const out = await run(alice(), 'create_folder', { name: unique('HoldsLocked') });
        const parent = await db()
            .selectFrom('folders')
            .select(['id', 'path'])
            .where('path', '=', out.path)
            .where('user_id', '=', alice())
            .executeTakeFirstOrThrow();
        const locked = await seedFolder(db(), alice(), unique('Inner'), { parent, isPrivate: true });
        const doc = await seedDocument(db(), { userId: alice(), name: unique('l') + '.pdf', folderId: locked.id });

        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Cannot undo: the folder is not empty');
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', doc).executeTakeFirstOrThrow()).folder_id).toBe(locked.id);
    });

    it('undo refuses after the folder was renamed', async () => {
        const out = await run(alice(), 'create_folder', { name: unique('Renamed') });
        const folder = await db().selectFrom('folders').select('id').where('path', '=', out.path).where('user_id', '=', alice()).executeTakeFirstOrThrow();

        await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Other') });
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/renamed since it was created/);
    });
});

describeDb('rename_folder', () => {
    it('renames a folder and re-paths the folders inside a renamed collection', async () => {
        const collection = await newFolder();
        const child = await newFolder('Kid', collection);
        const newName = unique('Renamed');
        const out = await run(alice(), 'rename_folder', { folder_id: collection.id, new_name: newName });
        const rows = await db().selectFrom('folders').select(['id', 'path']).where('id', 'in', [collection.id, child.id]).execute();

        expect(out).toMatchObject({ applied: true, to: '/' + newName });
        expect(Object.fromEntries(rows.map((r) => [r.id, r.path]))).toEqual({ [collection.id]: '/' + newName, [child.id]: '/' + newName + '/Kid' });
    });

    it('dry_run changes nothing', async () => {
        const folder = await newFolder();
        const before = await snapshotLibrary(db());

        await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Dry'), dry_run: true });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('refuses a name already taken, and the same text whether the holder is locked or not', async () => {
        const folder = await newFolder();
        const taken = await refusal(alice(), 'rename_folder', { folder_id: folder.id, new_name: 'Work' });
        const locked = await refusal(alice(), 'rename_folder', { folder_id: folder.id, new_name: 'Vault' });

        expect(taken).toMatch(/not available/);
        expect(locked.replace('Vault', 'Work')).toBe(taken);
    });

    it('undo restores the name and refuses after another rename', async () => {
        const folder = await newFolder();
        const first = await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Second') });

        await run(alice(), 'undo_write', { audit_id: first.audit_id });
        expect((await db().selectFrom('folders').select('path').where('id', '=', folder.id).executeTakeFirstOrThrow()).path).toBe(folder.path);

        const next = await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Third') });

        await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Fourth') });
        expect(await refusal(alice(), 'undo_write', { audit_id: next.audit_id })).toMatch(/renamed or moved again since/);
    });
});
