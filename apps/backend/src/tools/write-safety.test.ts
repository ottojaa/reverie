import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { describeDb, HIDDEN_DOCS, refusal, run } from '../testing/tool-world';
import { loadAudit, loadTagNames, snapshotLibrary } from '../testing/write-helpers';
import { useWriteFixtures } from '../testing/write-fixtures';
import { createSelection } from './selection.store';

const { ctx, alice, db, newSubfolder, newDoc } = useWriteFixtures();
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

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

        await db().updateTable('documents').set({ folder_id: ctx.world().folders.vault.id }).where('id', '=', id).execute();
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

        expect(await loadTagNames(db(), ctx.world().docs.inLockedFolder)).toEqual(['lockedtag']);
    });

    it('refuses a document that was locked or trashed after the search that produced the selection', async () => {
        const a = await newDoc({ tags: ['latechange'] });
        const b = await newDoc({ tags: ['latechange'] });
        const search = await run(alice(), 'search_documents', { tags: ['latechange'] });

        await db().updateTable('documents').set({ folder_id: ctx.world().folders.vault.id }).where('id', '=', a).execute();
        expect(await refusal(alice(), 'add_tags', { selection_id: search.selection_id, tags: ['x'] })).toContain(a);
        await db().updateTable('documents').set({ folder_id: null, deleted_at: new Date() }).where('id', '=', a).execute();
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
