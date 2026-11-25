import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env', async () => ({ env: (await import('../testing/upload-env.js')).testEnv }));
vi.mock('../queues/ocr.queue', async () => (await import('../testing/upload-env.js')).ocrQueueStub);
vi.mock('../queues/thumbnail.queue', async () => (await import('../testing/upload-env.js')).thumbnailQueueStub);
vi.mock('../transcode/cleanup', () => ({ deleteTranscodeSetIfUnused: async () => {} }));

import apiTokenAuth from '../app/plugins/api-token-auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import multipartPlugin from '../app/plugins/multipart.js';
import mcpUploadRoute from '../app/routes/mcp-upload.route.js';
import mcpRoute from '../app/routes/mcp.route.js';
import { createApiToken } from '../services/api-token.service.js';
import { createFakeUploadLinkPort } from '../testing/fake-upload-link-port.js';
import { describeDb, run } from '../testing/tool-world.js';
import { queued, storageRoot, testEnv } from '../testing/upload-env.js';
import { useWriteFixtures } from '../testing/write-fixtures.js';
import { callTool } from '../tools/registry.js';
import { createUploadLink, setUploadLinkPort, UPLOAD_LINK_TTL_SECONDS } from '../tools/upload-link.store.js';

const runShell = promisify(execFile);

describeDb('POST /mcp/upload', () => {
    const { alice, db, newFolder, newSubfolder } = useWriteFixtures();
    const links = createFakeUploadLinkPort();
    let app: FastifyInstance;
    let baseUrl: string;
    let localDir: string;

    beforeAll(async () => {
        setUploadLinkPort(links);
        localDir = await mkdtemp(join(tmpdir(), 'reverie-local-'));
        app = Fastify();
        await app.register(multipartPlugin);
        await app.register(errorHandler);
        await app.register(apiTokenAuth);
        await app.register(mcpRoute);
        await app.register(mcpUploadRoute);
        baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
        await setQuota(100_000_000);
    });
    afterAll(async () => {
        await app?.close();
        setUploadLinkPort(null);
        await rm(storageRoot, { recursive: true, force: true });
        await rm(localDir, { recursive: true, force: true });
    });

    async function setQuota(bytes: number) {
        // The seeded storage path is absolute, which the storage provider refuses; real users have a relative one.
        await db().updateTable('users').set({ storage_quota_bytes: bytes, storage_path: 'users/alice' }).where('id', '=', alice()).execute();
    }

    const loadDocsIn = (folderId: string) => db().selectFrom('documents').selectAll().where('folder_id', '=', folderId).orderBy('original_filename').execute();
    const linkTo = async (folderId: string) => (await createUploadLink({ userId: alice(), folderId })).secret;

    function toForm(names: string[], content = 'hello'): FormData {
        const form = new FormData();

        for (const name of names) form.append('file', new Blob([content]), name);

        return form;
    }

    async function post(token: string | null, body: FormData | string, headers: Record<string, string> = {}) {
        const auth: Record<string, string> = token === null ? {} : { 'x-upload-token': token };
        const response = await fetch(baseUrl + '/mcp/upload', { method: 'POST', headers: { ...auth, ...headers }, body });

        return { status: response.status, body: (await response.json()) as Record<string, any> };
    }

    /** A tools/call through /mcp, as an MCP client sends it. `body` replaces the JSON text for the escaping test. */
    async function callMcp(name: string, args: Record<string, unknown>, options: { headers?: Record<string, string>; escapeNonAscii?: boolean } = {}) {
        const { secret } = await createApiToken(alice(), 'uploader');
        const json = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
        const toEscape = (char: string) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
        const response = await app.inject({
            method: 'POST',
            url: '/mcp',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                authorization: 'Bearer ' + secret,
                host: new URL(baseUrl).host,
                ...options.headers,
            },
            payload: options.escapeNonAscii ? json.replace(/[\u0080-￿]/g, toEscape) : json,
        });

        expect(response.statusCode).toBe(200);

        const result = response.json().result as { isError?: boolean; content: Array<{ text: string }> };

        return { isError: result.isError === true, output: JSON.parse(result.content[0]!.text) };
    }

    async function runCommand(command: string) {
        const { stdout } = await runShell('sh', ['-c', command]);

        return JSON.parse(stdout) as Record<string, any>;
    }

    it('uploads local files with the command from the tool, once, and undo_write trashes them', async () => {
        const folder = await newSubfolder();
        const paths = ['receipt one.txt', 'notes;v2.md', 'table,"q".csv'].map((name) => join(localDir, name));

        for (const path of paths) await writeFile(path, 'text of ' + path);

        const { output } = await callMcp('upload_local_files', { folder_id: folder.id, paths });
        const answer = await runCommand(output.command);
        const docs = await loadDocsIn(folder.id);
        const names = ['receipt one.txt', 'notes;v2.md', 'table,"q".csv'];

        expect(answer).toEqual({
            uploaded: 3,
            folder,
            documents: names.map((name) => ({ id: docs.find((doc) => doc.original_filename === name)!.id, name })),
            audit_id: expect.any(String),
            undo: expect.stringContaining('undo_write'),
        });
        // curl calls all three application/octet-stream.
        expect(Object.fromEntries(docs.map((doc) => [doc.original_filename, doc.mime_type]))).toEqual({
            'receipt one.txt': 'text/plain',
            'notes;v2.md': 'text/markdown',
            'table,"q".csv': 'text/csv',
        });

        const jobs = await db()
            .selectFrom('processing_jobs')
            .select(['target_id', 'job_type'])
            .where(
                'target_id',
                'in',
                docs.map((doc) => doc.id),
            )
            .execute();

        expect(jobs.filter((job) => job.job_type === 'ocr')).toHaveLength(3);
        expect(queued.ocr).toEqual(expect.arrayContaining(docs.map((doc) => doc.id)));
        expect(await readdir(join(storageRoot, '.tmp-uploads'))).toEqual([]);
        expect(await runCommand(output.command)).toMatchObject({ statusCode: 404, error: 'upload_link_invalid' });
        expect(await loadDocsIn(folder.id)).toHaveLength(3);

        expect(await run(alice(), 'undo_write', { audit_id: answer.audit_id })).toMatchObject({ undoes: 'upload_local_files', documents_trashed: 3 });
        expect((await loadDocsIn(folder.id)).every((doc) => doc.deleted_at)).toBe(true);
    });

    it('keeps both files when a name is taken, and undoes the batch all or not at all', async () => {
        const folder = await newSubfolder();
        const first = await post(await linkTo(folder.id), toForm(['a.txt']));
        const second = await post(await linkTo(folder.id), toForm(['a.txt', 'b.txt']));

        expect(first.status).toBe(200);
        expect(second.body.documents).toMatchObject([{ name: 'a (1).txt', renamed_from: 'a.txt' }, { name: 'b.txt' }]);

        await run(alice(), 'rename_document', { document_id: second.body.documents[1].id, new_name: 'c.txt' });

        const undone = await callTool('undo_write', { audit_id: second.body.audit_id }, { user: { id: alice() } });

        expect(undone).toMatchObject({ ok: false, output: { error: expect.stringContaining('Cannot undo') } });
        expect((await loadDocsIn(folder.id)).every((doc) => !doc.deleted_at)).toBe(true);
    });

    it('lets exactly one of two concurrent requests use a link', async () => {
        const folder = await newSubfolder();
        const token = await linkTo(folder.id);
        const answers = await Promise.all([post(token, toForm(['x.txt'])), post(token, toForm(['x.txt']))]);

        expect(answers.map((answer) => answer.status).sort()).toEqual([200, 404]);
        expect(await loadDocsIn(folder.id)).toHaveLength(1);
    });

    it('answers a missing, wrong, foreign, used or expired token with the same 404', async () => {
        const folder = await newSubfolder();
        const { secret: apiToken } = await createApiToken(alice(), 'foreign');
        const used = await linkTo(folder.id);

        await post(used, toForm(['used.txt']));

        const expired = await linkTo(folder.id);

        links.advance(UPLOAD_LINK_TTL_SECONDS);

        const answers = await Promise.all([null, '', 'wrong', apiToken, used, expired].map((token) => post(token, toForm(['no.txt']))));
        const bearer = await post(null, toForm(['no.txt']), { authorization: 'Bearer ' + apiToken });

        for (const answer of [...answers, bearer]) expect(answer).toEqual({ status: 404, body: answers[0]!.body });

        expect(answers[0]!.body).toMatchObject({ error: 'upload_link_invalid' });
        expect((await loadDocsIn(folder.id)).map((doc) => doc.original_filename)).toEqual(['used.txt']);
    });

    it('checks the folder again at upload time, answering any change with that same 404', async () => {
        const changes = {
            locked: { is_private: true },
            trashed: { deleted_at: new Date() },
            collection: { type: 'collection' as const },
        };
        const unknown = await post('wrong', toForm(['no.txt']));

        for (const [label, change] of Object.entries(changes)) {
            const folder = await newSubfolder();
            const token = await linkTo(folder.id);

            await db().updateTable('folders').set(change).where('id', '=', folder.id).execute();
            expect(await post(token, toForm(['no.txt'])), label).toEqual(unknown);
            expect(await loadDocsIn(folder.id), label).toEqual([]);
        }

        const parent = await newFolder();
        const child = await newFolder('inside-locked', parent);
        const childToken = await linkTo(child.id);
        const removed = await newSubfolder();
        const removedToken = await linkTo(removed.id);

        await db().updateTable('folders').set({ is_private: true }).where('id', '=', parent.id).execute();
        await db().deleteFrom('folders').where('id', '=', removed.id).execute();
        expect(await post(childToken, toForm(['no.txt']))).toEqual(unknown);
        expect(await post(removedToken, toForm(['no.txt']))).toEqual(unknown);
        expect(await readdir(join(storageRoot, '.tmp-uploads'))).toEqual([]);
    });

    it('answers 400 without files and 413 for more than 50', async () => {
        const folder = await newSubfolder();
        const fieldsOnly = new FormData();

        fieldsOnly.append('folder_id', folder.id);
        expect(await post(await linkTo(folder.id), fieldsOnly)).toMatchObject({ status: 400, body: { error: 'NO_FILES' } });
        expect(await post(await linkTo(folder.id), '{}', { 'content-type': 'application/json' })).toMatchObject({ status: 400 });

        const many = toForm(Array.from({ length: 51 }, (_, index) => index + '.txt'));

        expect(await post(await linkTo(folder.id), many)).toMatchObject({ status: 413, body: { error: 'TOO_MANY_FILES' } });
        expect(await loadDocsIn(folder.id)).toEqual([]);
        expect(await readdir(join(storageRoot, '.tmp-uploads'))).toEqual([]);
    });

    it('ignores other fields: the link alone says where the files go', async () => {
        const folder = await newSubfolder();
        const elsewhere = await newSubfolder();
        const form = toForm(['here.txt']);

        form.append('folder_id', elsewhere.id);
        form.append('conflict_strategy', 'replace');
        expect(await post(await linkTo(folder.id), form)).toMatchObject({ status: 200, body: { folder } });
        expect(await loadDocsIn(elsewhere.id)).toEqual([]);
    });

    it('refuses files that do not fit the quota together, as a web upload does, storing none', async () => {
        const folder = await newSubfolder();
        const token = await linkTo(folder.id);
        const { storage_used_bytes: used } = await db().selectFrom('users').select('storage_used_bytes').where('id', '=', alice()).executeTakeFirstOrThrow();

        // Room for either file alone, not for both.
        await setQuota(Number(used) + 8);

        const answer = await post(token, toForm(['one.txt', 'two.txt'], 'hello'));

        await setQuota(100_000_000);
        expect(answer).toMatchObject({ status: 500, body: { error: 'STORAGE_ERROR', message: expect.stringContaining('Storage quota exceeded') } });
        expect(await loadDocsIn(folder.id)).toEqual([]);
    });

    it('builds the command URL from API_PUBLIC_URL, else from where the /mcp request came in', async () => {
        const folder = await newSubfolder();
        const args = { folder_id: folder.id, paths: ['/a.pdf'] };
        const direct = await callMcp('upload_local_files', args);
        const proxied = await callMcp('upload_local_files', args, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'docs.example.test' } });

        testEnv.API_PUBLIC_URL = 'https://example.test/api/';

        const configured = await callMcp('upload_local_files', args);

        testEnv.API_PUBLIC_URL = undefined;
        expect(direct.output.command).toContain("'" + baseUrl + "/mcp/upload'");
        expect(proxied.output.command).toContain("'https://docs.example.test/mcp/upload'");
        expect(configured.output.command).toContain("'https://example.test/api/mcp/upload'");
    });

    it('takes a note at the cap through /mcp even with every character escaped, and names the cap just over it', async () => {
        const folder = await newSubfolder();
        const atCap = 'ä'.repeat(128 * 1024);
        const saved = await callMcp('save_text_document', { folder_id: folder.id, name: 'big', content: atCap }, { escapeNonAscii: true });
        const over = await callMcp('save_text_document', { folder_id: folder.id, name: 'over', content: atCap + 'ä' }, { escapeNonAscii: true });

        expect(saved).toMatchObject({ isError: false, output: { applied: true } });
        expect(over).toMatchObject({ isError: true, output: { error: expect.stringContaining('256 KiB') } });
    });

    it('is rate limited', async () => {
        const limited = Fastify();

        await limited.register(fastifyRateLimit, { max: 2500, timeWindow: '15 minutes' });
        await limited.register(errorHandler);
        await limited.register(mcpUploadRoute);

        const send = () => limited.inject({ method: 'POST', url: '/mcp/upload' });

        for (let sent = 0; sent < 30; sent++) expect((await send()).statusCode).toBe(404);

        const over = await send();

        expect(over.statusCode).toBe(429);
        expect(over.json()).toMatchObject({ error: 'RATE_LIMITED' });
        await limited.close();
    });
});
