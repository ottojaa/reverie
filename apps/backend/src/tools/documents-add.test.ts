import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);
vi.mock('../transcode/cleanup', () => ({ deleteTranscodeSetIfUnused: async () => {} }));

import { createFakeUploadLinkPort } from '../testing/fake-upload-link-port';
import { describeDb, refusal, run } from '../testing/tool-world';
import { queued, storageRoot } from '../testing/upload-env';
import { useWriteFixtures } from '../testing/write-fixtures';
import { callTool } from './registry';
import { setUploadLinkPort } from './upload-link.store';

const CAP = 256 * 1024;

describeDb('adding documents with tools', () => {
    const { ctx, alice, db, newFolder, newSubfolder } = useWriteFixtures();
    const links = createFakeUploadLinkPort();

    beforeAll(async () => {
        setUploadLinkPort(links);
        await setQuota(100_000_000);
    });
    afterAll(async () => {
        setUploadLinkPort(null);
        await rm(storageRoot, { recursive: true, force: true });
    });

    async function setQuota(bytes: number) {
        // The seeded storage path is absolute, which the storage provider refuses; real users have a relative one.
        await db().updateTable('users').set({ storage_quota_bytes: bytes, storage_path: 'users/alice' }).where('id', '=', alice()).execute();
    }

    const loadDoc = (id: string) => db().selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const loadDocsIn = (folderId: string) => db().selectFrom('documents').selectAll().where('folder_id', '=', folderId).orderBy('original_filename').execute();
    const save = (folderId: string, name: string, content = '# Note', extra: Record<string, unknown> = {}) =>
        run(alice(), 'save_text_document', { folder_id: folderId, name, content, ...extra });

    it('saves text as a .md document, processed like an upload, without logging the text', async () => {
        const folder = await newSubfolder();
        const saved = await save(folder.id, 'Meeting summary', '# Päätökset\n- ship it');

        expect(saved).toEqual({
            applied: true,
            dry_run: false,
            document: { id: expect.any(String), name: 'Meeting summary.md', folder },
            audit_id: expect.any(String),
        });

        const doc = await loadDoc(saved.document.id);
        const jobs = await db().selectFrom('processing_jobs').select('job_type').where('target_id', '=', doc.id).orderBy('job_type').execute();
        const logged = await db().selectFrom('tool_audit_log').selectAll().where('id', '=', saved.audit_id).executeTakeFirstOrThrow();

        expect(doc).toMatchObject({ user_id: alice(), folder_id: folder.id, mime_type: 'text/markdown', ocr_status: 'pending' });
        expect(await readFile(join(storageRoot, doc.file_path), 'utf8')).toBe('# Päätökset\n- ship it');
        expect(jobs.map((job) => job.job_type)).toEqual(['ocr', 'thumbnail']);
        expect(queued.ocr).toContain(doc.id);
        expect(logged).toMatchObject({
            tool: 'save_text_document',
            state_after: { folder_id: folder.id, documents: [{ id: doc.id, name: doc.original_filename }] },
        });
        expect(logged.input).toEqual({ folder_id: folder.id, name: 'Meeting summary.md', bytes: doc.size_bytes && Number(doc.size_bytes) });
    });

    it('takes the document type from the extension and never overwrites', async () => {
        const folder = await newSubfolder();
        const types = { 'a.txt': 'text/plain', 'a.csv': 'text/csv', 'a.json': 'application/json', 'B.MD': 'text/markdown' };

        for (const [name, mime] of Object.entries(types)) expect((await loadDoc((await save(folder.id, name)).document.id)).mime_type, name).toBe(mime);

        const again = await save(folder.id, 'a.txt', 'other');

        expect(again).toMatchObject({ document: { name: 'a (1).txt' }, renamed_from: 'a.txt' });
        expect(await loadDocsIn(folder.id)).toHaveLength(5);
    });

    it('refuses names with slashes and other extensions', async () => {
        const folder = await newSubfolder();
        const attempt = (name: string) => refusal(alice(), 'save_text_document', { folder_id: folder.id, name, content: 'x' });

        for (const name of ['a/b.md', '../b.md', 'a\\b.md']) expect(await attempt(name), name).toMatch(/slashes/);

        for (const name of ['run.sh', 'page.html', 'v1.2']) expect(await attempt(name), name).toMatch(/Unsupported extension/);

        expect(await attempt('   ')).toMatch(/Invalid input: name/);
        expect(await loadDocsIn(folder.id)).toEqual([]);
    });

    it('caps the content at 256 KiB of UTF-8, not at a number of characters', async () => {
        const folder = await newSubfolder();
        // Two bytes each, so the text over the cap is far shorter than the cap in characters.
        const atCap = 'ä'.repeat(CAP / 2);
        const saved = await save(folder.id, 'at-cap', atCap);
        const over = await refusal(alice(), 'save_text_document', { folder_id: folder.id, name: 'over', content: atCap + 'a' });

        expect(Number((await loadDoc(saved.document.id)).size_bytes)).toBe(CAP);
        expect(over).toBe('Content is too large, the limit is 256 KiB (262144 bytes of UTF-8): got 262145 bytes');
        expect(await loadDocsIn(folder.id)).toHaveLength(1);
    });

    it('says why when the text does not fit the quota', async () => {
        const folder = await newSubfolder();

        await setQuota(1);
        expect(await refusal(alice(), 'save_text_document', { folder_id: folder.id, name: 'n', content: 'too much' })).toMatch(/^Storage quota exceeded/);
        await setQuota(100_000_000);
        expect(await loadDocsIn(folder.id)).toEqual([]);
    });

    it('refuses locked, trashed, foreign and collection targets in both tools', async () => {
        const { folders } = ctx.world();
        const collection = await newFolder();
        const targets = [folders.lockedFolder, folders.vaultInner, folders.bin, folders.bobs, collection];

        for (const folder of targets) {
            const text = await refusal(alice(), 'save_text_document', { folder_id: folder.id, name: 'n', content: 'x' });
            const upload = await refusal(alice(), 'upload_local_files', { folder_id: folder.id, paths: ['/a.pdf'], dry_run: true });

            expect(text, folder.path).toMatch(folder === collection ? /not a collection/ : /Folder not found/);
            expect(upload, folder.path).toBe(text);
        }
    });

    it('only checks on a dry run: no document, no link, no audit row', async () => {
        const folder = await newSubfolder();
        const countLog = async () => (await db().selectFrom('tool_audit_log').select('id').execute()).length;
        const logged = await countLog();
        const linked = links.entries.size;

        expect(await save(folder.id, 'plan', 'x', { dry_run: true })).toEqual({ applied: false, dry_run: true, document: { name: 'plan.md', folder } });
        expect(await run(alice(), 'upload_local_files', { folder_id: folder.id, paths: ['~/a.pdf', '/b.pdf'], dry_run: true })).toEqual({
            applied: false,
            dry_run: true,
            folder,
            files: 2,
        });
        expect(await loadDocsIn(folder.id)).toEqual([]);
        expect(links.entries.size).toBe(linked);
        expect(await countLog()).toBe(logged);
    });

    it('answers upload_local_files with a command for the server’s public address and no audit_id', async () => {
        const folder = await newSubfolder();
        const input = { folder_id: folder.id, paths: ['~/Downloads/receipt.pdf'] };
        const result = await callTool('upload_local_files', input, { user: { id: alice() }, publicBaseUrl: 'https://docs.example.test/api' });
        const output = result.output as { command: string; expires_at: string };

        expect(output).toMatchObject({ folder, files: 1, next_step: expect.stringContaining('works once') });
        expect(output).not.toHaveProperty('audit_id');
        expect(output.command).toContain("'https://docs.example.test/api/mcp/upload'");
        expect(output.command).toContain('"$HOME"');
        expect(Date.parse(output.expires_at) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
        expect(await refusal(alice(), 'upload_local_files', input)).toMatch(/API_PUBLIC_URL/);
    });

    it('takes 1 to 50 paths that each name one file', async () => {
        const folder = await newSubfolder();
        const attempt = (paths: string[]) => callTool('upload_local_files', { folder_id: folder.id, paths, dry_run: true }, { user: { id: alice() } });
        const bad = ['a.pdf', './a.pdf', '~', '~bob/a.pdf', '/dir/', '/dir/*.pdf', '/a?.pdf', '/a\nb.pdf', '/a\\b.pdf', ''];

        for (const path of bad) expect((await attempt([path])).ok, JSON.stringify(path)).toBe(false);

        expect((await attempt([])).ok).toBe(false);
        expect((await attempt(Array(51).fill('/a.pdf'))).ok).toBe(false);
        expect((await attempt(Array(50).fill('/a [1]; "b".pdf'))).ok).toBe(true);
    });

    it('undoes a saved document by moving it to the trash, once', async () => {
        const folder = await newSubfolder();
        const saved = await save(folder.id, 'undo-me');
        const preview = await run(alice(), 'undo_write', { audit_id: saved.audit_id, dry_run: true });

        expect(preview).toMatchObject({ undoes: 'save_text_document', documents_trashed: 1, applied: false });
        expect((await loadDoc(saved.document.id)).deleted_at).toBeNull();
        expect(await run(alice(), 'undo_write', { audit_id: saved.audit_id })).toMatchObject({ applied: true, documents_trashed: 1 });
        expect((await loadDoc(saved.document.id)).deleted_at).toBeInstanceOf(Date);
        expect(await refusal(alice(), 'undo_write', { audit_id: saved.audit_id })).toMatch(/Already undone/);
    });

    it('refuses to undo a document renamed, moved or trashed since', async () => {
        const folder = await newSubfolder();
        const elsewhere = await newSubfolder();
        const renamed = await save(folder.id, 'to-rename');
        const moved = await save(folder.id, 'to-move');
        const trashed = await save(folder.id, 'to-trash');

        await run(alice(), 'rename_document', { document_id: renamed.document.id, new_name: 'renamed.md' });
        await run(alice(), 'move_documents', { document_ids: [moved.document.id], folder_id: elsewhere.id });
        await db().updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', trashed.document.id).execute();

        const undo = (auditId: string) => refusal(alice(), 'undo_write', { audit_id: auditId });

        expect(await undo(renamed.audit_id)).toMatch(/^Cannot undo: .*moved or renamed/);
        expect(await undo(moved.audit_id)).toMatch(/^Cannot undo: .*moved or renamed/);
        expect(await undo(trashed.audit_id)).toMatch(/Documents not found/);
        expect((await loadDoc(renamed.document.id)).deleted_at).toBeNull();
        expect((await loadDoc(moved.document.id)).deleted_at).toBeNull();
    });
});
