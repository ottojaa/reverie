import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test' } }));

import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import apiTokenAuth from '../app/plugins/api-token-auth.js';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import apiTokensRoute from '../app/routes/api-tokens.route.js';
import mcpRoute from '../app/routes/mcp.route.js';
import { createApiToken, revokeApiToken } from '../services/api-token.service.js';
import { dbProxy } from '../testing/db-proxy.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import { listTools } from '../tools/registry.js';

const hidden = (world: World) => [world.docs.inLockedFolder, world.docs.inVault, world.docs.inVaultInner, world.docs.trashed, world.docs.inTrashedFolder];

describeDb('/mcp', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let url: URL;

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(authPlugin);
        await app.register(apiTokenAuth);
        await app.register(errorHandler);
        await app.register(apiTokensRoute);
        await app.register(mcpRoute);
        await app.listen({ port: 0, host: '127.0.0.1' });

        const address = app.server.address();

        url = new URL('http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0) + '/mcp');
    });
    afterAll(() => app.close());

    async function connect(secret: string): Promise<Client> {
        const client = new Client({ name: 'test-client', version: '1.0.0' });

        await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + secret } } }));

        return client;
    }

    async function call(client: Client, name: string, args: Record<string, unknown>) {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as { type: string; text: string }[])[0]!.text;

        return { isError: result.isError === true, output: JSON.parse(text) };
    }

    const rawPost = (headers: Record<string, string>) =>
        app.inject({
            method: 'POST',
            url: '/mcp',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
            payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        });

    describe('authentication', () => {
        it('answers 401 without a token, with a wrong one, and with a malformed header', async () => {
            expect((await rawPost({})).statusCode).toBe(401);
            expect((await rawPost({ authorization: 'Bearer rvr_notarealtoken' })).statusCode).toBe(401);
            expect((await rawPost({ authorization: 'Bearer wrong' })).statusCode).toBe(401);
            expect((await rawPost({ authorization: 'Basic abc' })).statusCode).toBe(401);
            expect((await rawPost({})).headers['www-authenticate']).toBe('Bearer');
        });

        it('refuses a web login JWT on /mcp, and an API token on the JWT routes', async () => {
            const { alice } = ctx.world();
            const jwt = app.jwt.sign({ sub: alice, email: 'alice@example.test' });
            const { secret } = await createApiToken(alice, 'cross');

            expect((await rawPost({ authorization: 'Bearer ' + jwt })).statusCode).toBe(401);
            expect((await app.inject({ method: 'GET', url: '/api-tokens', headers: { authorization: 'Bearer ' + secret } })).statusCode).toBe(401);
            expect((await app.inject({ method: 'GET', url: '/api-tokens', headers: { authorization: 'Bearer ' + jwt } })).statusCode).toBe(200);
        });

        it('stops a revoked token on the very next request', async () => {
            const { alice } = ctx.world();
            const { token, secret } = await createApiToken(alice, 'short-lived');

            expect((await rawPost({ authorization: 'Bearer ' + secret })).statusCode).toBe(200);
            await revokeApiToken(alice, token.id);
            expect((await rawPost({ authorization: 'Bearer ' + secret })).statusCode).toBe(401);
        });

        it('refuses an expired token and a token of a deactivated user', async () => {
            const { db, alice, bob } = ctx.world();
            const expired = await createApiToken(alice, 'old', { kind: 'agent', expiresAt: new Date(Date.now() - 1000) });
            const fresh = await createApiToken(alice, 'fresh', { kind: 'agent', expiresAt: new Date(Date.now() + 60_000) });
            const bobs = await createApiToken(bob, 'bobs');

            expect((await rawPost({ authorization: 'Bearer ' + expired.secret })).statusCode).toBe(401);
            expect((await rawPost({ authorization: 'Bearer ' + fresh.secret })).statusCode).toBe(200);

            await db.updateTable('users').set({ is_active: false }).where('id', '=', bob).execute();
            expect((await rawPost({ authorization: 'Bearer ' + bobs.secret })).statusCode).toBe(401);
            await db.updateTable('users').set({ is_active: true }).where('id', '=', bob).execute();
        });

        it('has no session to open or end', async () => {
            expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
            expect((await app.inject({ method: 'DELETE', url: '/mcp' })).statusCode).toBe(405);
        });
    });

    describe('with the SDK client', () => {
        it('lists exactly the registry tools, with self-contained input schemas', async () => {
            const client = await connect((await createApiToken(ctx.world().alice, 'lister')).secret);
            const { tools } = await client.listTools();

            expect(tools.map((tool) => tool.name)).toEqual(listTools().map((tool) => tool.name));

            for (const tool of tools) {
                expect(tool.inputSchema.type, tool.name).toBe('object');
                expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(/\$ref|\$schema|definitions/);
                expect(tool.annotations?.readOnlyHint, tool.name).toBe(listTools().find((t) => t.name === tool.name)!.access === 'read');
            }

            await client.close();
        });

        it('finds documents and tags them from a selection, logs the write, and undoes it', async () => {
            const { db, alice, docs } = ctx.world();
            const client = await connect((await createApiToken(alice, 'tagger')).secret);
            const found = await call(client, 'search_documents', { query: 'Acme' });

            expect(found.isError).toBe(false);
            expect(found.output.rows.map((row: { id: string }) => row.id)).toEqual([docs.invoice]);

            const tagged = await call(client, 'add_tags', { selection_id: found.output.selection_id, tags: ['portugal'] });

            expect(tagged.output).toMatchObject({ applied: true, tags_added: 1 });

            const logged = await db.selectFrom('tool_audit_log').selectAll().where('id', '=', tagged.output.audit_id).executeTakeFirstOrThrow();

            expect(logged).toMatchObject({ user_id: alice, tool: 'add_tags', undone_at: null });
            expect((await call(client, 'search_documents', { tags: ['portugal'] })).output.rows).toHaveLength(1);

            const undone = await call(client, 'undo_write', { audit_id: tagged.output.audit_id });

            expect(undone.isError).toBe(false);
            expect((await call(client, 'search_documents', { tags: ['portugal'] })).output.total).toBe(0);
            await client.close();
        });

        it('reports a refusal as a tool error, not a transport failure', async () => {
            const client = await connect((await createApiToken(ctx.world().alice, 'refused')).secret);
            const refused = await call(client, 'get_document', { document_id: ctx.world().docs.inLockedFolder });

            expect(refused.isError).toBe(true);
            expect(refused.output.error).toMatch(/not found/i);
            await client.close();
        });

        it('never shows a locked or trashed item, and a token only sees its own user’s library', async () => {
            const world = ctx.world();
            const alice = await connect((await createApiToken(world.alice, 'alice-reader')).secret);
            const bob = await connect((await createApiToken(world.bob, 'bob-reader')).secret);

            for (const word of ['LOCKEDWORD', 'TRASHEDWORD']) expect((await call(alice, 'search_documents', { query: word })).output.total, word).toBe(0);

            for (const id of hidden(world)) expect((await call(alice, 'get_document', { document_id: id })).isError, id).toBe(true);

            expect((await call(bob, 'search_documents', { query: 'Acme' })).output.total).toBe(0);
            expect((await call(bob, 'get_document', { document_id: world.docs.invoice })).isError).toBe(true);
            expect((await call(bob, 'search_documents', { query: 'BOBWORD' })).output.total).toBe(1);

            // A write aimed at another user's document is refused too, and changes nothing.
            const stolen = await call(bob, 'add_tags', { document_ids: [world.docs.invoice], tags: ['mine'] });

            expect(stolen.isError).toBe(true);
            await alice.close();
            await bob.close();
        });
    });

    it('lists, creates and revokes a user’s own tokens over the REST routes', async () => {
        const { alice, bob } = ctx.world();
        const headers = { authorization: 'Bearer ' + app.jwt.sign({ sub: alice, email: 'alice@example.test' }) };
        const created = await app.inject({ method: 'POST', url: '/api-tokens', headers, payload: { name: ' Laptop ' } });
        const body = created.json() as { token: { id: string; name: string; prefix: string }; secret: string };

        expect(created.statusCode).toBe(201);
        expect(body.token.name).toBe('Laptop');
        expect(body.secret.startsWith(body.token.prefix)).toBe(true);

        const stored = await dbProxy.db.selectFrom('api_tokens').selectAll().where('id', '=', body.token.id).executeTakeFirstOrThrow();

        expect(JSON.stringify(stored)).not.toContain(body.secret);

        const listed = (await app.inject({ method: 'GET', url: '/api-tokens', headers })).json() as { tokens: { id: string }[] };

        expect(listed.tokens.map((token) => token.id)).toContain(body.token.id);
        expect(JSON.stringify(listed)).not.toContain(body.secret);

        const bobHeaders = { authorization: 'Bearer ' + app.jwt.sign({ sub: bob, email: 'bob@example.test' }) };

        expect((await app.inject({ method: 'DELETE', url: '/api-tokens/' + body.token.id, headers: bobHeaders })).statusCode).toBe(404);
        expect((await app.inject({ method: 'DELETE', url: '/api-tokens/' + body.token.id, headers })).statusCode).toBe(204);
        expect((await app.inject({ method: 'DELETE', url: '/api-tokens/' + body.token.id, headers })).statusCode).toBe(404);
        expect(
            ((await app.inject({ method: 'GET', url: '/api-tokens', headers })).json() as { tokens: { id: string }[] }).tokens.map((t) => t.id),
        ).not.toContain(body.token.id);
    });

    it('limits each token on its own, so one noisy client does not starve the others', async () => {
        const limited = Fastify();

        await limited.register(fastifyRateLimit, { max: 2500, timeWindow: '15 minutes' });
        await limited.register(apiTokenAuth);
        await limited.register(mcpRoute);

        const { alice, bob } = ctx.world();
        const noisy = await createApiToken(alice, 'noisy');
        const quiet = await createApiToken(bob, 'quiet');
        const post = (secret: string) =>
            limited.inject({
                method: 'POST',
                url: '/mcp',
                headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + secret },
                payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
            });

        // Same IP for everyone, as behind the reverse proxy.
        for (let sent = 0; sent < 300; sent++) expect((await post(noisy.secret)).statusCode).toBe(200);

        expect((await post(noisy.secret)).statusCode).toBe(429);
        expect((await post(quiet.secret)).statusCode).toBe(200);
        await limited.close();
    }, 30_000);

    it('records when a token was last used', async () => {
        const { alice } = ctx.world();
        const { token, secret } = await createApiToken(alice, 'usage');

        expect(token.last_used_at).toBeNull();
        await rawPost({ authorization: 'Bearer ' + secret });

        const used = await dbProxy.db.selectFrom('api_tokens').select('last_used_at').where('id', '=', token.id).executeTakeFirstOrThrow();

        expect(used.last_used_at).toBeInstanceOf(Date);
    });
});
