import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { describeDb, refusal, run } from '../testing/tool-world';
import { loadAudit, loadTagNames, snapshotLibrary } from '../testing/write-helpers';
import { useWriteFixtures } from '../testing/write-fixtures';

const { ctx, alice, db, newFolder, newDoc } = useWriteFixtures();

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
