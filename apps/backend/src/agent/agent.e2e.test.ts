import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    env: {
        JWT_SECRET: 's'.repeat(32),
        JWT_ACCESS_EXPIRES: '15m',
        NODE_ENV: 'test',
        AGENT_URL: undefined as string | undefined,
        AGENT_SECRET: undefined as string | undefined,
        AGENT_SECRET_FILE: undefined as string | undefined,
    },
    sent: [] as { userId: string; event: string; data: AgentEvent }[],
}));

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: h.env }));
vi.mock('../websocket/index.js', () => ({
    sendToUser: (userId: string, event: string, data: AgentEvent) => {
        h.sent.push({ userId, event, data });
    },
}));

import apiTokenAuth from '../app/plugins/api-token-auth.js';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import agentRoute from '../app/routes/agent.route.js';
import mcpRoute from '../app/routes/mcp.route.js';
import { dbProxy } from '../testing/db-proxy.js';
import { describeDb, useWorld } from '../testing/tool-world.js';

/**
 * The whole path with nothing mocked but the socket and the `claude` binary: the backend's agent routes,
 * the real reverie-agent wrapper as a child process, a fake `claude` that records its arguments and makes a
 * real /mcp call, and the real tool registry against Postgres.
 */

const WRAPPER = join(__dirname, '../../../agent/server.mjs');
const FAKE_CLAUDE = join(__dirname, '../testing/fake-claude.mjs');

async function freePort(): Promise<number> {
    return new Promise((resolve) => {
        const server = createServer();

        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };

            server.close(() => resolve(port));
        });
    });
}

async function waitFor<T>(read: () => T | undefined, what: string): Promise<T> {
    for (let i = 0; i < 200; i++) {
        const value = read();

        if (value !== undefined) return value;

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error('Timed out waiting for ' + what);
}

describeDb('in-app agent, end to end', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let wrapper: ChildProcess;
    let stateDir: string;
    let wrapperUrl: string;
    let mcpUrl: string;
    let adminJwt: string;
    let userJwt: string;

    beforeAll(async () => {
        const world = ctx.world();

        await dbProxy.db.updateTable('users').set({ role: 'admin' }).where('id', '=', world.alice).execute();

        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(authPlugin);
        await app.register(apiTokenAuth);
        await app.register(errorHandler);
        await app.register(agentRoute);
        await app.register(mcpRoute);
        await app.listen({ port: 0, host: '127.0.0.1' });
        mcpUrl = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port + '/mcp';
        adminJwt = app.jwt.sign({ sub: world.alice, email: 'alice@example.test' });
        userJwt = app.jwt.sign({ sub: world.bob, email: 'bob@example.test' });

        stateDir = mkdtempSync(join(tmpdir(), 'reverie-agent-test-'));

        const port = await freePort();

        wrapperUrl = 'http://127.0.0.1:' + port;
        wrapper = spawn('node', [WRAPPER], {
            env: {
                PATH: process.env.PATH,
                PORT: String(port),
                CLAUDE_BIN: FAKE_CLAUDE,
                FAKE_CLAUDE_DIR: stateDir,
                AGENT_SECRET_FILE: join(stateDir, 'secret'),
                REVERIE_MCP_URL: mcpUrl,
                AGENT_CWD: stateDir,
            },
            stdio: 'ignore',
        });
        await waitUntilHealthy(wrapperUrl);

        h.env.AGENT_URL = wrapperUrl;
        h.env.AGENT_SECRET_FILE = join(stateDir, 'secret');
    }, 60_000);

    afterAll(async () => {
        wrapper?.kill('SIGKILL');
        await app?.close();
        rmSync(stateDir, { recursive: true, force: true });
    });

    const as = (jwt: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
        app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: 'Bearer ' + jwt } });

    const runs = () =>
        readFileSync(join(stateDir, 'runs.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { args: string[]; prompt: string; cwd: string });

    /** Sends a prompt as the admin and waits for the run to end; returns the chat id and the events it produced. */
    async function chat(prompt: string, chatId?: string) {
        const before = h.sent.length;
        const response = await as(adminJwt, 'POST', '/agent/messages', { prompt, chat_id: chatId });

        expect(response.statusCode).toBe(202);

        const id = response.json().chat_id as string;
        const finished = await waitFor(() => h.sent.slice(before).find((e) => e.data.chat_id === id && e.data.type === 'run_finished'), 'run_finished');

        return {
            id,
            finished: finished.data,
            events: h.sent
                .slice(before)
                .filter((e) => e.data.chat_id === id)
                .map((e) => e.data),
        };
    }

    async function chatDetail(id: string) {
        return (await as(adminJwt, 'GET', '/agent/chats/' + id)).json() as {
            running: boolean;
            messages: { role: string; error: string | null; items: Record<string, unknown>[] }[];
        };
    }

    describe('the wrapper', () => {
        it('answers /health to anyone but wants the shared secret for everything else', async () => {
            expect((await fetch(wrapperUrl + '/health')).status).toBe(200);
            expect((await fetch(wrapperUrl + '/status')).status).toBe(401);
            expect((await fetch(wrapperUrl + '/run', { method: 'POST', body: '{}' })).status).toBe(401);
            // No secret file exists yet, so even a guess is refused rather than matched against nothing.
            expect((await fetch(wrapperUrl + '/status', { headers: { authorization: 'Bearer guess' } })).status).toBe(401);
        });

        it('accepts only the secret the backend generated, which it writes without any setup', async () => {
            await as(adminJwt, 'GET', '/agent/status');

            const secret = readFileSync(join(stateDir, 'secret'), 'utf8');

            expect(secret.length).toBeGreaterThanOrEqual(32);
            expect(statSync(join(stateDir, 'secret')).mode & 0o777).toBe(0o644);
            expect((await fetch(wrapperUrl + '/status', { headers: { authorization: 'Bearer ' + secret + 'x' } })).status).toBe(401);
            expect((await fetch(wrapperUrl + '/status', { headers: { authorization: 'Bearer ' + secret } })).status).toBe(200);
        });
    });

    describe('status', () => {
        it('reports ready, then not signed in, then unavailable', async () => {
            expect((await as(adminJwt, 'GET', '/agent/status')).json()).toEqual({ state: 'ready' });

            writeFileSync(join(stateDir, 'signed-out'), '');
            expect((await as(adminJwt, 'GET', '/agent/status')).json()).toEqual({ state: 'not_signed_in' });
            rmSync(join(stateDir, 'signed-out'));

            const url = h.env.AGENT_URL;

            h.env.AGENT_URL = 'http://127.0.0.1:' + (await freePort());
            expect((await as(adminJwt, 'GET', '/agent/status')).json()).toEqual({ state: 'unavailable' });
            h.env.AGENT_URL = url;
        });
    });

    describe('a chat message', () => {
        it('reaches claude with the exact arguments, a short-lived token and nothing else switched on', async () => {
            const { id, finished, events } = await chat('hello there');
            const [run] = runs().slice(-1);
            const args = run!.args;
            const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1]!);
            const token = mcpConfig.mcpServers.reverie.headers.Authorization as string;

            expect(finished).toEqual({ type: 'run_finished', chat_id: id, error: null });
            expect(run!.prompt).toBe('hello there');
            expect(run!.cwd).toContain('reverie-agent-test-');
            expect(mcpConfig).toEqual({ mcpServers: { reverie: { type: 'http', url: mcpUrl, headers: { Authorization: token } } } });
            expect(token).toMatch(/^Bearer rvr_/);
            expect(args.filter((arg) => !arg.startsWith('{') && !arg.startsWith('Bearer'))).toEqual([
                '-p',
                '--output-format',
                'stream-json',
                '--verbose',
                '--include-partial-messages',
                '--tools',
                '',
                '--disallowedTools',
                'Bash,BashOutput,KillShell,Read,Write,Edit,MultiEdit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,Task,Agent,TodoWrite,Skill,SlashCommand,ExitPlanMode,mcp__reverie__upload_local_files',
                '--allowedTools',
                'mcp__reverie__*',
                '--permission-mode',
                'dontAsk',
                '--permission-prompts',
                'none',
                '--strict-mcp-config',
                '--mcp-config',
                '--disable-slash-commands',
                '--append-system-prompt',
                expect.stringContaining('only tools are the Reverie library tools'),
            ]);
            expect(events.map((event) => event.type)).toEqual(['run_started', 'text_delta', 'run_finished']);

            const detail = await chatDetail(id);

            expect(detail.running).toBe(false);
            expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
            expect(detail.messages[1]!.items).toEqual([{ type: 'text', text: 'Done.' }]);
        });

        it('mints a token that lives 20 minutes at most and is revoked when the run ends', async () => {
            const rows = await dbProxy.db.selectFrom('api_tokens').selectAll().where('kind', '=', 'agent').execute();

            expect(rows.length).toBeGreaterThan(0);

            for (const row of rows) {
                expect(row.revoked_at).not.toBeNull();
                expect(row.expires_at!.getTime() - row.created_at.getTime()).toBeLessThanOrEqual(20 * 60_000 + 1000);
            }
        });

        it('resumes the claude session on the next message in the same chat', async () => {
            const first = await chat('first');
            await chat('second', first.id);

            const args = runs().slice(-1)[0]!.args;

            expect(args.slice(args.indexOf('--resume'))).toEqual(['--resume', 'session-new']);
        });

        it('refuses a second message while the chat is still running', async () => {
            const first = await as(adminJwt, 'POST', '/agent/messages', { prompt: 'one' });
            const id = first.json().chat_id as string;
            const second = await as(adminJwt, 'POST', '/agent/messages', { prompt: 'two', chat_id: id });

            expect(second.statusCode).toBe(409);
            await waitFor(() => h.sent.find((e) => e.data.chat_id === id && e.data.type === 'run_finished'), 'run_finished');
        });
    });

    describe('stopping', () => {
        it('kills claude when the admin presses Stop, and the chat is free again', async () => {
            rmSync(join(stateDir, 'release'), { force: true });
            rmSync(join(stateDir, 'started'), { force: true });

            const before = h.sent.length;
            const id = (await as(adminJwt, 'POST', '/agent/messages', { prompt: 'hold' })).json().chat_id as string;
            const pid = Number(await waitFor(() => readStarted(join(stateDir, 'started')), 'claude to start'));

            expect((await chatDetail(id)).running).toBe(true);
            expect((await as(adminJwt, 'POST', '/agent/chats/' + id + '/stop')).statusCode).toBe(204);

            const finished = await waitFor(() => h.sent.slice(before).find((e) => e.data.chat_id === id && e.data.type === 'run_finished'), 'run_finished');

            expect(finished.data).toMatchObject({ error: null });
            await waitFor(() => (isAlive(pid) ? undefined : true), 'claude to exit');
            expect((await chatDetail(id)).running).toBe(false);
            // The partial answer is kept.
            expect((await chatDetail(id)).messages[1]!.items).toEqual([{ type: 'text', text: 'Looking through your library for anything that matches. ' }]);
        });
    });

    describe('deleting a chat mid-run', () => {
        it('aborts the run and saves nothing, without logging a failed save', async () => {
            rmSync(join(stateDir, 'release'), { force: true });
            rmSync(join(stateDir, 'started'), { force: true });

            const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

            try {
                const before = h.sent.length;
                const id = (await as(adminJwt, 'POST', '/agent/messages', { prompt: 'hold' })).json().chat_id as string;

                await waitFor(() => readStarted(join(stateDir, 'started')), 'claude to start');
                expect((await as(adminJwt, 'DELETE', '/agent/chats/' + id)).statusCode).toBe(204);
                await waitFor(() => h.sent.slice(before).find((e) => e.data.chat_id === id && e.data.type === 'run_finished'), 'run_finished');

                expect(errors).not.toHaveBeenCalled();
                expect(await dbProxy.db.selectFrom('agent_chats').select('id').where('id', '=', id).execute()).toEqual([]);
                expect(await dbProxy.db.selectFrom('agent_messages').select('id').where('chat_id', '=', id).execute()).toEqual([]);
            } finally {
                errors.mockRestore();
            }
        });
    });

    describe('a write tool call', () => {
        it('shows up with an audit id, really writes through /mcp, and Undo reverses it', async () => {
            const world = ctx.world();
            const doc = world.docs.loose;
            const prompt =
                'call ' + JSON.stringify({ name: 'move_documents', input: { document_ids: [doc], folder_id: world.folders.invoices.id, dry_run: false } });
            const { id, finished, events } = await chat(prompt);
            const result = events.find((event) => event.type === 'tool_result');

            expect(finished).toMatchObject({ error: null });
            expect(events.find((event) => event.type === 'tool_use')).toMatchObject({ name: 'move_documents' });
            expect(result).toMatchObject({ ok: true, applied: true, output: { moved: 1 } });

            const auditId = (result as { audit_id: string }).audit_id;
            const moved = () => dbProxy.db.selectFrom('documents').select('folder_id').where('id', '=', doc).executeTakeFirstOrThrow();

            expect((await moved()).folder_id).toBe(world.folders.invoices.id);

            const stored = (await chatDetail(id)).messages[1]!.items.find((item) => item.type === 'tool');

            expect(stored).toMatchObject({ audit_id: auditId, applied: true, undone: false });

            const undo = await as(adminJwt, 'POST', '/agent/undo', { audit_id: auditId });

            expect(undo.json()).toMatchObject({ ok: true });
            expect((await moved()).folder_id).toBeNull();
            expect((await chatDetail(id)).messages[1]!.items.find((item) => item.type === 'tool')).toMatchObject({ undone: true });
        });

        it('keeps a dry run free of an audit id, so there is nothing to undo', async () => {
            const world = ctx.world();
            const prompt =
                'call ' +
                JSON.stringify({ name: 'move_documents', input: { document_ids: [world.docs.loose], folder_id: world.folders.invoices.id, dry_run: true } });
            const { events } = await chat(prompt);
            const result = events.find((event) => event.type === 'tool_result');

            expect(result).toMatchObject({ ok: true });
            expect((result as { audit_id?: string }).audit_id).toBeUndefined();
        });

        it('turns a refused call into a failed tool row instead of a failed run', async () => {
            const world = ctx.world();
            const prompt =
                'call ' +
                JSON.stringify({ name: 'move_documents', input: { document_ids: [world.docs.bobs], folder_id: world.folders.invoices.id, dry_run: false } });
            const { events, finished } = await chat(prompt);

            expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ ok: false });
            expect(finished).toMatchObject({ error: null });
        });
    });

    describe('failures', () => {
        it('reports a signed-out claude as not_signed_in and stores the message', async () => {
            const { id, finished } = await chat('signed-out');

            expect(finished).toMatchObject({ error: { code: 'not_signed_in' } });
            expect((await chatDetail(id)).messages[1]!.error).toContain('Not logged in');
        });

        it('reports a crash with the wrapper-captured stderr', async () => {
            const { finished } = await chat('crash');

            expect(finished).toMatchObject({ error: { code: 'failed', message: expect.stringContaining('claude crashed') } });
        });

        it('reports an unreachable agent as unavailable', async () => {
            const url = h.env.AGENT_URL;

            h.env.AGENT_URL = 'http://127.0.0.1:' + (await freePort());

            const { finished } = await chat('anyone there');

            h.env.AGENT_URL = url;
            expect(finished).toMatchObject({ error: { code: 'unavailable' } });
        });
    });

    describe('access', () => {
        it('answers 403 to a non-admin on every agent route and creates nothing', async () => {
            const chatId = '11111111-1111-4111-8111-111111111111';
            const before = await dbProxy.db.selectFrom('agent_chats').select('id').execute();
            const calls: [method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown][] = [
                ['GET', '/agent/status'],
                ['GET', '/agent/chats'],
                ['GET', '/agent/chats/' + chatId],
                ['DELETE', '/agent/chats/' + chatId],
                ['POST', '/agent/messages', { prompt: 'hi' }],
                ['POST', '/agent/chats/' + chatId + '/stop'],
                ['POST', '/agent/undo', { audit_id: chatId }],
            ];
            const responses = [];

            // One at a time: the admin check loads the db module lazily, which races the test's module mock.
            for (const [method, url, payload] of calls) responses.push(await as(userJwt, method, url, payload));

            expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403, 403, 403]);
            expect(await dbProxy.db.selectFrom('agent_chats').select('id').execute()).toHaveLength(before.length);
        });

        it('answers 401 without a token', async () => {
            expect((await app.inject({ method: 'GET', url: '/agent/chats' })).statusCode).toBe(401);
        });

        it("does not show one admin's chat to anyone else", async () => {
            const { id } = await chat('private');
            const other = await dbProxy.db.selectFrom('users').select('id').where('id', '=', ctx.world().bob).executeTakeFirstOrThrow();

            await dbProxy.db.updateTable('users').set({ role: 'admin' }).where('id', '=', other.id).execute();

            const bobAdmin = app.jwt.sign({ sub: other.id, email: 'bob@example.test' });

            expect((await as(bobAdmin, 'GET', '/agent/chats/' + id)).statusCode).toBe(404);
            expect((await as(bobAdmin, 'POST', '/agent/undo', { audit_id: '11111111-1111-4111-8111-111111111111' })).json()).toMatchObject({ ok: false });
            await dbProxy.db.updateTable('users').set({ role: 'user' }).where('id', '=', other.id).execute();
        });
    });
});

function readStarted(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8') || undefined;
    } catch {
        return undefined;
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}

async function waitUntilHealthy(url: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
        const ok = await fetch(url + '/health').then(
            (response) => response.ok,
            () => false,
        );

        if (ok) return;

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('Wrapper did not start');
}
