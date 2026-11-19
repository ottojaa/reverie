import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedDocument, seedFolder } from '../testing/seed';
import { describeDb, HIDDEN_DOCS, refusal, run, useWorld } from '../testing/tool-world';
import { loadAudit, loadTagNames, snapshotLibrary } from '../testing/write-helpers';
import { createSelection } from './selection.store';

const ctx = useWorld();
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

let counter = 0;
const unique = (label: string) => label + '-' + ++counter;

async function newFolder(name = unique('F'), parent?: { id: string; path: string }) {
    return seedFolder(ctx.world().db, ctx.world().alice, name, parent ? { parent } : {});
}

/** A real folder (documents can only be moved into folders, not collections), inside a fresh collection. */
async function newSubfolder() {
    return newFolder(unique('Sub'), await newFolder());
}

async function newDoc(opts: { folderId?: string | null; name?: string; tags?: string[] } = {}) {
    return seedDocument(ctx.world().db, {
        userId: ctx.world().alice,
        name: opts.name ?? unique('doc') + '.pdf',
        folderId: opts.folderId ?? null,
        tags: opts.tags ?? [],
    });
}

const alice = () => ctx.world().alice;
const db = () => ctx.world().db;

describeDb('add_tags', () => {
    it('adds tags (lowercased), reports counts, and logs the write with before and after', async () => {
        const id = await newDoc({ tags: ['kept'] });
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['Alpha', 'kept'] });
        const [entry] = (await loadAudit(db(), alice())).filter((row) => row.id === out.audit_id);

        expect(out).toMatchObject({ applied: true, dry_run: false, documents: 1, tags_added: 1 });
        expect(await loadTagNames(db(), id)).toEqual(['alpha', 'kept']);
        expect(entry).toMatchObject({ user_id: alice(), tool: 'add_tags', undone_at: null });
        expect(entry!.input).toMatchObject({ document_ids: [id], tags: ['Alpha', 'kept'] });
        expect(entry!.state_before).toBeDefined();
        expect(entry!.state_after).toEqual({ added: { [id]: ['alpha'] } });
    });

    it('makes the new tag searchable', async () => {
        const id = await newDoc();

        await run(alice(), 'add_tags', { document_ids: [id], tags: ['searchable-tag'] });
        expect((await run(alice(), 'search_documents', { tags: ['searchable-tag'] })).rows.map((r: { id: string }) => r.id)).toEqual([id]);
    });

    it('dry_run changes nothing and logs nothing', async () => {
        const id = await newDoc();
        const before = await snapshotLibrary(db());
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['ghost'], dry_run: true });

        expect(out).toMatchObject({ dry_run: true, applied: false, tags_added: 1 });
        expect(out.audit_id).toBeUndefined();
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('does nothing and logs nothing when every tag is already there', async () => {
        const id = await newDoc({ tags: ['same'] });
        const before = await loadAudit(db(), alice());
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['same'] });

        expect(out).toMatchObject({ applied: false, note: 'Nothing to change' });
        expect(await loadAudit(db(), alice())).toEqual(before);
    });

    it('rejects an invalid tag, leaving no audit row', async () => {
        const id = await newDoc();
        const before = await loadAudit(db(), alice());

        expect(await refusal(alice(), 'add_tags', { document_ids: [id], tags: ['this tag has way too many words in it'] })).toMatch(/Invalid tag/);
        expect(await loadAudit(db(), alice())).toEqual(before);
    });

    it('undo removes exactly the added tags; refuses once a tag is gone', async () => {
        const id = await newDoc({ tags: ['stay'] });
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['temp', 'stay'] });
        const undone = await run(alice(), 'undo_write', { audit_id: out.audit_id });

        expect(undone).toMatchObject({ applied: true, undoes: 'add_tags' });
        expect(await loadTagNames(db(), id)).toEqual(['stay']);

        const second = await run(alice(), 'add_tags', { document_ids: [id], tags: ['temp'] });

        await run(alice(), 'remove_tags', { document_ids: [id], tags: ['temp'] });
        expect(await refusal(alice(), 'undo_write', { audit_id: second.audit_id })).toMatch(/Cannot undo: 1 of the added tags are no longer/);
    });

    it('acts on every match of a selection', async () => {
        const a = await newDoc({ tags: ['batchmark'] });
        const b = await newDoc({ tags: ['batchmark'] });
        const search = await run(alice(), 'search_documents', { tags: ['batchmark'] });
        const out = await run(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['batched'] });

        expect(out.documents).toBe(2);
        expect(await loadTagNames(db(), a)).toContain('batched');
        expect(await loadTagNames(db(), b)).toContain('batched');
    });

    it('returns counts and a short sample for a large write', async () => {
        const ids = await Promise.all(Array.from({ length: 15 }, () => newDoc()));
        const out = await run(alice(), 'add_tags', { document_ids: ids, tags: ['bulk'] });

        expect(out).toMatchObject({ documents: 15, tags_added: 15 });
        expect(out.sample).toHaveLength(10);
    });

    it('never puts picture-derived text into a photo’s write result', async () => {
        const out = await run(alice(), 'add_tags', { document_ids: [ctx.world().docs.photo], tags: ['vacation'], dry_run: true });

        expect(JSON.stringify(out)).not.toMatch(/PLANTED/);
        expect(JSON.stringify(out)).toContain('IMG_0001.jpg');
    });
});

describeDb('remove_tags', () => {
    it('removes tags, logs the source, and undo puts them back with that source', async () => {
        const id = await newDoc({ tags: ['one', 'two'] });
        const out = await run(alice(), 'remove_tags', { document_ids: [id], tags: ['one'] });

        expect(await loadTagNames(db(), id)).toEqual(['two']);
        expect(out).toMatchObject({ applied: true, tags_removed: 1 });

        await run(alice(), 'undo_write', { audit_id: out.audit_id });
        expect(await loadTagNames(db(), id)).toEqual(['one', 'two']);
    });

    it('dry_run changes nothing', async () => {
        const id = await newDoc({ tags: ['one'] });
        const before = await snapshotLibrary(db());

        await run(alice(), 'remove_tags', { document_ids: [id], tags: ['one'], dry_run: true });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('undo refuses when the tag was added again', async () => {
        const id = await newDoc({ tags: ['again'] });
        const out = await run(alice(), 'remove_tags', { document_ids: [id], tags: ['again'] });

        await run(alice(), 'add_tags', { document_ids: [id], tags: ['again'] });
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/added again/);
    });
});

describeDb('rename_document', () => {
    it('renames, makes the new name searchable, and logs it', async () => {
        const id = await newDoc({ name: 'before-name.pdf' });
        const out = await run(alice(), 'rename_document', { document_id: id, new_name: 'zebra-final.pdf' });
        const row = await db().selectFrom('documents').select('original_filename').where('id', '=', id).executeTakeFirstOrThrow();

        expect(row.original_filename).toBe('zebra-final.pdf');
        expect(out).toMatchObject({ applied: true, from: 'before-name.pdf', to: 'zebra-final.pdf' });
        expect((await run(alice(), 'search_documents', { query: 'zebra' })).rows.map((r: { id: string }) => r.id)).toContain(id);
        expect((await loadAudit(db(), alice())).some((entry) => entry.id === out.audit_id && entry.tool === 'rename_document')).toBe(true);
    });

    it('dry_run changes nothing', async () => {
        const id = await newDoc();
        const before = await snapshotLibrary(db());

        await run(alice(), 'rename_document', { document_id: id, new_name: 'dry.pdf', dry_run: true });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('refuses a path-like name and a name already used in the folder', async () => {
        const folder = await newFolder();
        const a = await newDoc({ folderId: folder.id, name: 'taken.pdf' });
        const b = await newDoc({ folderId: folder.id });

        expect(await refusal(alice(), 'rename_document', { document_id: a, new_name: '../x.pdf' })).toMatch(/Invalid|invalid/);
        expect(await refusal(alice(), 'rename_document', { document_id: b, new_name: 'taken.pdf' })).toMatch(/already exists/);
    });

    it('undo restores the name and refuses after another rename', async () => {
        const id = await newDoc({ name: 'orig.pdf' });
        const first = await run(alice(), 'rename_document', { document_id: id, new_name: 'second.pdf' });

        await run(alice(), 'undo_write', { audit_id: first.audit_id });
        expect((await db().selectFrom('documents').select('original_filename').where('id', '=', id).executeTakeFirstOrThrow()).original_filename).toBe(
            'orig.pdf',
        );

        const next = await run(alice(), 'rename_document', { document_id: id, new_name: 'third.pdf' });

        await run(alice(), 'rename_document', { document_id: id, new_name: 'fourth.pdf' });
        expect(await refusal(alice(), 'undo_write', { audit_id: next.audit_id })).toMatch(/renamed again since \(now fourth\.pdf\)/);
    });
});

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

    it('counts a locked or trashed document as content too, so undo cannot drop it to the root', async () => {
        const out = await run(alice(), 'create_folder', { name: unique('HoldsLocked') });
        const folder = await db().selectFrom('folders').select('id').where('path', '=', out.path).where('user_id', '=', alice()).executeTakeFirstOrThrow();
        const locked = await seedDocument(db(), { userId: alice(), name: unique('l') + '.pdf', folderId: folder.id, isPrivate: true });

        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Cannot undo: the folder is not empty');
        expect((await db().selectFrom('documents').select('folder_id').where('id', '=', locked).executeTakeFirstOrThrow()).folder_id).toBe(folder.id);
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

describeDb('undo_write', () => {
    it('dry_run reports the undo and changes nothing', async () => {
        const id = await newDoc();
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['undoable'] });
        const before = await snapshotLibrary(db());
        const preview = await run(alice(), 'undo_write', { audit_id: out.audit_id, dry_run: true });

        expect(preview).toMatchObject({ dry_run: true, applied: false, undoes: 'add_tags' });
        expect(await snapshotLibrary(db())).toEqual(before);
    });

    it('marks the entry undone, logs the undo itself, and refuses a second undo', async () => {
        const id = await newDoc();
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['twice'] });
        const undone = await run(alice(), 'undo_write', { audit_id: out.audit_id });
        const log = await loadAudit(db(), alice());

        expect(log.find((e) => e.id === out.audit_id)?.undone_at).toBeInstanceOf(Date);
        expect(log.find((e) => e.id === undone.audit_id)?.tool).toBe('undo_write');
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Already undone: ' + out.audit_id);
    });

    it('cannot undo an undo', async () => {
        const id = await newDoc();
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['redo'] });
        const undone = await run(alice(), 'undo_write', { audit_id: out.audit_id });

        expect(await refusal(alice(), 'undo_write', { audit_id: undone.audit_id })).toBe('This write cannot be undone: undo_write');
    });

    it('refuses another user’s entry and an unknown one with the same message', async () => {
        const out = await run(alice(), 'add_tags', { document_ids: [await newDoc()], tags: ['mine'] });
        const other = await refusal(ctx.world().bob, 'undo_write', { audit_id: out.audit_id });
        const unknown = await refusal(alice(), 'undo_write', { audit_id: UNKNOWN });

        expect(other.replace(out.audit_id, 'ID')).toBe(unknown.replace(UNKNOWN, 'ID'));
    });

    it('two concurrent undos of one entry: one applies, the other is refused', async () => {
        const id = await newDoc();
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['race'] });
        const results = await Promise.allSettled([
            run(alice(), 'undo_write', { audit_id: out.audit_id }),
            run(alice(), 'undo_write', { audit_id: out.audit_id }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('refuses to undo documents that were locked or trashed since', async () => {
        const id = await newDoc();
        const out = await run(alice(), 'add_tags', { document_ids: [id], tags: ['later-locked'] });

        await db().updateTable('documents').set({ is_private: true }).where('id', '=', id).execute();
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toMatch(/Documents not found/);
        expect(await loadTagNames(db(), id)).toEqual(['later-locked']);
    });
});

describeDb('writes cannot reach locked or trashed items', () => {
    const target = () => ctx.world().folders.invoices.id;
    const writes = (id: string) =>
        [
            ['add_tags', { document_ids: [id], tags: ['x'] }],
            ['remove_tags', { document_ids: [id], tags: ['lockedtag'] }],
            ['rename_document', { document_id: id, new_name: 'renamed.pdf' }],
            ['move_documents', { document_ids: [id], folder_id: target() }],
        ] as const;

    it('refuses every hidden document in every document write, with the text an unknown id gets', async () => {
        for (const key of HIDDEN_DOCS) {
            const id = ctx.world().docs[key];

            for (const [tool, input] of writes(id)) {
                const [unknownTool, unknownInput] = writes(UNKNOWN).find(([name]) => name === tool)!;
                const message = await refusal(alice(), tool, input);

                expect(message.replace(id, 'ID'), key + ' via ' + tool).toBe((await refusal(alice(), unknownTool, unknownInput)).replace(UNKNOWN, 'ID'));
            }
        }
    });

    it('refuses hidden documents reached through a selection', async () => {
        const selection = await createSelection(
            alice(),
            HIDDEN_DOCS.map((key) => ctx.world().docs[key]),
        );

        for (const [tool, input] of [
            ['add_tags', { selection_id: selection, tags: ['x'] }],
            ['remove_tags', { selection_id: selection, tags: ['lockedtag'] }],
            ['move_documents', { selection_id: selection, folder_id: target() }],
        ] as const) {
            expect(await refusal(alice(), tool, input), tool).toMatch(/^Documents not found/);
        }

        expect(await loadTagNames(db(), ctx.world().docs.lockedOwn)).toEqual(['lockedtag']);
    });

    it('refuses a document that was locked or trashed after the search that produced the selection', async () => {
        const a = await newDoc({ tags: ['latechange'] });
        const b = await newDoc({ tags: ['latechange'] });
        const search = await run(alice(), 'search_documents', { tags: ['latechange'] });

        await db().updateTable('documents').set({ is_private: true }).where('id', '=', a).execute();
        expect(await refusal(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['x'] })).toContain(a);
        await db().updateTable('documents').set({ is_private: false, deleted_at: new Date() }).where('id', '=', a).execute();
        expect(await refusal(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['x'] })).toContain(a);
        expect(await loadTagNames(db(), b)).toEqual(['latechange']);
    });

    it('refuses a locked or trashed folder as a move target, a parent, or a rename target', async () => {
        const { folders } = ctx.world();
        const doc = await newDoc();
        const hidden = [folders.vault, folders.vaultInner, folders.lockedFolder, folders.bin];
        const unknownMove = await refusal(alice(), 'move_documents', { document_ids: [doc], folder_id: UNKNOWN });
        const unknownParent = await refusal(alice(), 'create_folder', { name: 'Nope', parent_id: UNKNOWN });
        const unknownRename = await refusal(alice(), 'rename_folder', { folder_id: UNKNOWN, new_name: 'Nope' });

        for (const folder of hidden) {
            expect((await refusal(alice(), 'move_documents', { document_ids: [doc], folder_id: folder.id })).replace(folder.id, 'ID')).toBe(
                unknownMove.replace(UNKNOWN, 'ID'),
            );
            expect((await refusal(alice(), 'create_folder', { name: 'Nope', parent_id: folder.id })).replace(folder.id, 'ID')).toBe(
                unknownParent.replace(UNKNOWN, 'ID'),
            );
            expect((await refusal(alice(), 'rename_folder', { folder_id: folder.id, new_name: 'Nope' })).replace(folder.id, 'ID')).toBe(
                unknownRename.replace(UNKNOWN, 'ID'),
            );
        }
    });

    it('refuses to undo a move back into a folder that has since been locked', async () => {
        const from = await newSubfolder();
        const to = await newSubfolder();
        const id = await newDoc({ folderId: from.id });
        const out = await run(alice(), 'move_documents', { document_ids: [id], folder_id: to.id });

        await db().updateTable('folders').set({ is_private: true }).where('id', '=', from.id).execute();
        expect(await refusal(alice(), 'undo_write', { audit_id: out.audit_id })).toBe('Cannot undo: the folder the documents came from is no longer available');
    });

    it('another user cannot target the first user’s documents or folders', async () => {
        const { bob, docs, folders } = ctx.world();

        expect(await refusal(bob, 'add_tags', { document_ids: [docs.invoice], tags: ['x'] })).toMatch(/Documents not found/);
        expect(await refusal(bob, 'rename_folder', { folder_id: folders.work.id, new_name: 'Mine' })).toMatch(/Folder not found/);
    });
});

describeDb('selections', () => {
    it('are user-scoped: another user’s selection_id is refused like an unknown one', async () => {
        const search = await run(alice(), 'search_documents', { query: '' });
        const { bob } = ctx.world();
        const foreign = await refusal(bob, 'add_tags', { selection_id: search.selection_id, tags: ['x'] });
        const unknown = await refusal(bob, 'add_tags', { selection_id: UNKNOWN, tags: ['x'] });

        expect(foreign).toBe(unknown);
        expect(foreign).toMatch(/Selection not found or expired/);
    });

    it('expire after their time to live', async () => {
        const search = await run(alice(), 'search_documents', { query: '' });

        ctx.port().advance(60 * 60 - 1);
        await run(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['still-valid'], dry_run: true });
        ctx.port().advance(2);
        expect(await refusal(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['x'] })).toMatch(/Selection not found or expired/);
    });

    it('need exactly one of document_ids and selection_id', async () => {
        const id = await newDoc();

        expect(await refusal(alice(), 'add_tags', { tags: ['x'] })).toBe('Pass exactly one of document_ids or selection_id');
        expect(await refusal(alice(), 'add_tags', { tags: ['x'], document_ids: [id], selection_id: UNKNOWN })).toBe(
            'Pass exactly one of document_ids or selection_id',
        );
    });

    it('refuse a write over the size limit', async () => {
        const selection = await createSelection(
            alice(),
            Array.from({ length: 1001 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0')),
        );

        expect(await refusal(alice(), 'add_tags', { selection_id: selection, tags: ['x'] })).toMatch(/^Too many documents \(1001\)/);
    });
});
