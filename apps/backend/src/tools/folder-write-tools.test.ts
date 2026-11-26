import { sql } from 'kysely';
import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedDocument, seedFolder } from '../testing/seed';
import { describeDb, refusal, run } from '../testing/tool-world';
import { loadAudit, snapshotLibrary } from '../testing/write-helpers';
import { trashFolder } from '../services/folders/trash';
import { moveFolder } from '../services/folders/writes';
import { useWriteFixtures } from '../testing/write-fixtures';

const { alice, db, unique, newFolder, newSubfolder, newDoc } = useWriteFixtures();

async function fetchDocumentFolder(id: string): Promise<string | null> {
    return (await db().selectFrom('documents').select('folder_id').where('id', '=', id).executeTakeFirstOrThrow()).folder_id;
}

async function fetchFolderAt(path: string) {
    return db().selectFrom('folders').selectAll().where('path', '=', path).where('user_id', '=', alice()).executeTakeFirstOrThrow();
}

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

    it('refuses a filename clash in a folder and at the top level, logging nothing', async () => {
        const folder = await newSubfolder();
        const resident = await newDoc({ folderId: folder.id, name: 'same.pdf' });
        const clash = await newDoc({ name: 'same.pdf' });
        const before = await loadAudit(db(), alice());

        expect(await refusal(alice(), 'move_documents', { document_ids: [clash], folder_id: folder.id })).toMatch(/would clash/);
        expect(await refusal(alice(), 'move_documents', { document_ids: [resident], folder_id: null })).toMatch(/would clash/);
        expect(await loadAudit(db(), alice())).toEqual(before);
    });

    it('moves into a top-level folder and out to no folder at all, and undoes both', async () => {
        const top = await newFolder();
        const deep = await newSubfolder();
        const id = await newDoc({ folderId: deep.id });
        const intoTop = await run(alice(), 'move_documents', { document_ids: [id], folder_id: top.id });
        const outOfAll = await run(alice(), 'move_documents', { document_ids: [id], folder_id: null });

        expect(outOfAll).toMatchObject({ applied: true, moved: 1, target: { id: null, path: '/' } });
        expect(await fetchDocumentFolder(id)).toBeNull();

        await run(alice(), 'undo_write', { audit_id: outOfAll.audit_id });
        expect(await fetchDocumentFolder(id)).toBe(top.id);

        await run(alice(), 'undo_write', { audit_id: intoTop.audit_id });
        expect(await fetchDocumentFolder(id)).toBe(deep.id);
    });

    it('will not move into a folder locked from further up', async () => {
        const hidden = await seedFolder(db(), alice(), unique('Hidden'), { isPrivate: true });
        const inside = await newFolder('Deep', await newFolder('Mid', hidden));
        const id = await newDoc();

        expect(await refusal(alice(), 'move_documents', { document_ids: [id], folder_id: inside.id })).toBe('Folder not found: ' + inside.id);
        expect(await fetchDocumentFolder(id)).toBeNull();
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

        // The document goes to the trash together with its folder.
        await trashFolder(alice(), to.id);
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/^Cannot undo|not found/);
        expect(await fetchDocumentFolder(id)).toBe(to.id);
    });

    it('undo puts a document back at the top level', async () => {
        const to = await newSubfolder();
        const id = await newDoc();
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });

        await run(alice(), 'undo_write', { audit_id: out.audit_id });
        expect(await fetchDocumentFolder(id)).toBeNull();
    });
});

describeDb('create_folder', () => {
    it('creates folders three levels deep and logs each', async () => {
        const name = unique('Top');
        const top = await run(alice(), 'create_folder', { name });
        const middle = await run(alice(), 'create_folder', { name: 'Middle', parent_id: (await fetchFolderAt(top.path)).id });
        const leaf = await run(alice(), 'create_folder', { name: 'Leaf', parent_id: (await fetchFolderAt(middle.path)).id });
        const listed = (await run(alice(), 'list_folders')).folders.find((folder: { name: string }) => folder.name === name);

        expect(top).toMatchObject({ applied: true, path: '/' + name });
        expect(leaf).toMatchObject({ applied: true, path: '/' + name + '/Middle/Leaf' });
        expect(listed.folders[0].folders[0]).toMatchObject({ name: 'Leaf' });
        expect((await loadAudit(db(), alice())).map((entry) => entry.id)).toEqual(expect.arrayContaining([top.audit_id, middle.audit_id, leaf.audit_id]));
    });

    it('dry_run changes nothing', async () => {
        const before = await snapshotLibrary(db());
        const out = await run(alice(), 'create_folder', { name: unique('Dry'), dry_run: true });

        expect(out).toMatchObject({ dry_run: true, applied: false });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('refuses a name with a slash', async () => {
        expect(await refusal(alice(), 'create_folder', { name: 'a/b' })).toMatch(/Invalid input: name/);
    });

    it('refuses a name already taken in any casing, without saying whether the holder is locked', async () => {
        const taken = await refusal(alice(), 'create_folder', { name: 'Work' });
        const locked = await refusal(alice(), 'create_folder', { name: 'Vault' });

        expect(taken).toMatch(/not available/);
        expect(locked.replace('Vault', 'Work')).toBe(taken);
        expect(await refusal(alice(), 'create_folder', { name: 'work' })).toBe(taken.replace('Work', 'work'));
    });

    it('undo of an empty folder sends it to the trash instead of deleting it', async () => {
        const name = unique('Empty');
        const out = await run(alice(), 'create_folder', { name });
        const undone = await run(alice(), 'undo_write', { audit_id: out.audit_id });

        expect(undone).toMatchObject({ applied: true, folder_trashed: '/' + name });
        expect((await fetchFolderAt('/' + name)).deleted_at).toBeInstanceOf(Date);
    });

    it('undo refuses a folder that now holds a document, and one that holds a child folder', async () => {
        const holdsDoc = await run(alice(), 'create_folder', { name: unique('Full') });
        const docFolder = await fetchFolderAt(holdsDoc.path);

        await newDoc({ folderId: docFolder.id });
        expect(await refusal(alice(), 'undo_write', { audit_id: holdsDoc.audit_id })).toBe('Cannot undo: the folder is not empty');

        const holdsChild = await run(alice(), 'create_folder', { name: unique('Parent') });

        await run(alice(), 'create_folder', { name: 'Child', parent_id: (await fetchFolderAt(holdsChild.path)).id });
        expect(await refusal(alice(), 'undo_write', { audit_id: holdsChild.audit_id })).toBe('Cannot undo: the folder is not empty');
        expect((await fetchFolderAt(holdsDoc.path)).deleted_at).toBeNull();
    });

    it('counts a private subfolder and its document as content, so undo cannot trash them unseen', async () => {
        const out = await run(alice(), 'create_folder', { name: unique('HoldsLocked') });
        const parent = await fetchFolderAt(out.path);
        const locked = await seedFolder(db(), alice(), unique('Inner'), { parent, isPrivate: true });
        const doc = await seedDocument(db(), { userId: alice(), name: unique('l') + '.pdf', folderId: locked.id });

        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Cannot undo: the folder is not empty');
        expect(await fetchDocumentFolder(doc)).toBe(locked.id);
    });

    it('undo refuses after the folder was renamed or moved', async () => {
        const renamed = await run(alice(), 'create_folder', { name: unique('Renamed') });
        const moved = await run(alice(), 'create_folder', { name: unique('Moved') });

        await run(alice(), 'rename_folder', { folder_id: (await fetchFolderAt(renamed.path)).id, new_name: unique('Other') });
        await moveFolder(alice(), (await fetchFolderAt(moved.path)).id, (await newFolder()).id);

        for (const out of [renamed, moved]) {
            expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/renamed or moved since it was created/);
        }
    });

    it('undo still works after a folder above was renamed', async () => {
        const parent = await newFolder();
        const out = await run(alice(), 'create_folder', { name: 'Kept', parent_id: parent.id });
        const newName = unique('Above');

        await run(alice(), 'rename_folder', { folder_id: parent.id, new_name: newName });
        expect(await run(alice(), 'undo_write', { audit_id: out.audit_id })).toMatchObject({ applied: true, folder_trashed: '/' + newName + '/Kept' });
    });
});

describeDb('rename_folder', () => {
    it('renames a folder and re-paths everything beneath it', async () => {
        const top = await newFolder();
        const child = await newFolder('Kid', top);
        const grandchild = await newFolder('Grandkid', child);
        const newName = unique('Renamed');
        const out = await run(alice(), 'rename_folder', { folder_id: top.id, new_name: newName });
        const rows = await db().selectFrom('folders').select(['id', 'path']).where('id', 'in', [top.id, child.id, grandchild.id]).execute();

        expect(out).toMatchObject({ applied: true, to: '/' + newName });
        expect(Object.fromEntries(rows.map((r) => [r.id, r.path]))).toEqual({
            [top.id]: '/' + newName,
            [child.id]: '/' + newName + '/Kid',
            [grandchild.id]: '/' + newName + '/Kid/Grandkid',
        });
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

    it('undo refuses a rename recorded before folders could be nested, which cannot be checked', async () => {
        const folder = await newFolder();
        const out = await run(alice(), 'rename_folder', { folder_id: folder.id, new_name: unique('Old') });

        await sql`UPDATE tool_audit_log SET state_after = state_after - 'parent_id' WHERE id = ${out.audit_id}`.execute(db());
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/recorded before folders could be nested/);
    });
});
