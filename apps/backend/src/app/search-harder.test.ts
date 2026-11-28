import sensible from '@fastify/sensible';
import { SearchResponseSchema, type SearchResponse } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ anthropic: vi.fn() }));

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
// No ML service, so plain search is word search alone and what it misses is certain.
vi.mock('../config/env', async (importOriginal) => ({
    env: {
        ...(await importOriginal<typeof import('../config/env')>()).env,
        JWT_SECRET: 's'.repeat(32),
        JWT_ACCESS_EXPIRES: '15m',
        NODE_ENV: 'test',
        ML_URL: undefined,
        LLM_ENABLED: true,
        ANTHROPIC_API_KEY: 'test-key',
        LOCAL_LLM_TIMEOUT_MS: 5000,
    },
}));
// The real SDK over a fake network: what is asserted is the body that would leave the server.
vi.mock('../llm/anthropic.client', async (importOriginal) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');

    return {
        ...(await importOriginal<typeof import('../llm/anthropic.client')>()),
        getAnthropicClient: () => new Anthropic({ apiKey: 'test-key', fetch: h.anthropic }),
    };
});
vi.mock('../search/hybrid-search', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../search/hybrid-search')>();

    return { ...actual, findRankedDocuments: vi.fn(actual.findRankedDocuments) };
});

import { findRankedDocuments } from '../search/hybrid-search';
import { buildPlanPrompt } from '../search/harder/plan';
import { seedDocument, seedFolder } from '../testing/seed.js';
import { describeDb, HIDDEN_DOCS, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import searchRoute from './routes/search.route.js';

const TODAY = '2026-11-28';
const YEAR_2025 = '2025-01-01..2025-12-31';

interface Plan {
    rewordings: string[];
    date: { from: string; to: string } | null;
}

function toAnthropicAnswer(text: string, stopReason = 'end_turn'): Response {
    return Response.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
    });
}

function answerWith(plan: Plan): void {
    h.anthropic.mockImplementation(async () => toAnthropicAnswer(JSON.stringify(plan)));
}

const sentBodies = () => h.anthropic.mock.calls.map((call) => JSON.parse(call[1].body as string) as Record<string, unknown>);

/** What every composed search was narrowed to. */
const searched = () => vi.mocked(findRankedDocuments).mock.calls.map(([parsed]) => parsed);

describeDb('POST /search/harder', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let cabin: { id: string; path: string };
    let docs: Record<'bill' | 'outsideFolder' | 'otherType' | 'older' | 'publicTwin', string>;

    const world = (): World => ctx.world();
    const token = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);

    function post(body: Record<string, unknown>, headers = { authorization: 'Bearer ' + token(world().alice) }) {
        return app.inject({ method: 'POST', url: '/search/harder', payload: { today: TODAY, ...body }, headers });
    }

    async function harder(body: Record<string, unknown>): Promise<SearchResponse> {
        const response = await post(body);

        expect(response.statusCode, response.body).toBe(200);

        return SearchResponseSchema.parse(response.json());
    }

    const ids = (response: SearchResponse) => response.results.map((hit) => (hit.result_type === 'document' ? hit.document_id : hit.id));

    async function useSummarySettings(values: Record<string, string>) {
        await world().db.deleteFrom('server_settings').execute();

        for (const [key, value] of Object.entries(values)) {
            await world()
                .db.insertInto('server_settings')
                .values({ key, value: JSON.stringify(value), updated_at: new Date(), updated_by: null })
                .execute();
        }
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(searchRoute);
        await app.ready();

        const { db, alice } = world();
        cabin = await seedFolder(db, alice, 'Cabin');
        const bill = { userId: alice, ocrText: 'Fortum sähkölasku mökki 84 EUR', category: 'receipt', folderId: cabin.id };
        const in2025 = new Date('2025-02-01T12:00:00Z');
        docs = {
            bill: await seedDocument(db, { ...bill, name: 'scan-0412.pdf', extractedDate: in2025 }),
            outsideFolder: await seedDocument(db, { ...bill, name: 'scan-0413.pdf', extractedDate: in2025, folderId: null }),
            otherType: await seedDocument(db, { ...bill, name: 'scan-0414.pdf', extractedDate: in2025, category: 'contract' }),
            older: await seedDocument(db, { ...bill, name: 'scan-0415.pdf', extractedDate: new Date('2020-02-01T12:00:00Z') }),
            publicTwin: await seedDocument(db, { userId: alice, name: 'public.pdf', ocrText: 'LOCKEDWORD TRASHEDWORD BOBWORD content' }),
        };
    }, 60_000);
    afterAll(() => app.close());

    beforeEach(async () => {
        await useSummarySettings({});
        h.anthropic.mockReset();
        vi.mocked(findRankedDocuments).mockClear();
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        answerWith({ rewordings: ['Fortum sähkölasku', 'electricity invoice'], date: null });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('finds a document plain search misses for the sentence', async () => {
        const plain = await app.inject({
            url: '/search',
            query: { q: 'power bill from the cabin' },
            headers: { authorization: 'Bearer ' + token(world().alice) },
        });
        const response = await harder({ q: 'power bill from the cabin' });

        expect(plain.json().total).toBe(0);
        expect(ids(response)).toContain(docs.bill);
        expect(response.total).toBe(response.results.length);
        expect(response.facets).toBeUndefined();
    });

    it('sends the model the free text and the date, and nothing else of the library or the query', async () => {
        const q = `power bill last year folder:Cabin type:receipt date:${YEAR_2025} read:"date:${YEAR_2025} last year"`;

        await harder({ q, folder_id: cabin.id });

        const [body, ...more] = sentBodies();

        expect(more).toEqual([]);
        expect(Object.keys(body!).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system']);
        expect(body!['model']).toBe('claude-haiku-5-5');
        expect(body!['output_config']).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
        expect(body!['system']).toBe(buildPlanPrompt('', TODAY).system);
        expect(body!['messages']).toEqual([{ role: 'user', content: `Today: ${TODAY}\nSearch: power bill last year` }]);

        const sent = JSON.stringify(body);

        for (const secret of ['Cabin', cabin.id, 'folder:', 'type:receipt', 'read:', YEAR_2025, 'Fortum', 'scan-0412']) {
            expect(sent).not.toContain(secret);
        }
    });

    it.each([
        ['typed', `date:${YEAR_2025}`],
        ['read', `last year date:${YEAR_2025} read:"date:${YEAR_2025} last year"`],
    ])('keeps the typed folder and type and a %s date on every search, over the model’s date', async (_, dateTokens) => {
        answerWith({ rewordings: ['Fortum sähkölasku', 'Fortum mökki'], date: { from: '2020-01-01', to: '2020-12-31' } });

        const response = await harder({ q: `power bill folder:Cabin type:receipt ${dateTokens}` });

        expect(ids(response)).toEqual([docs.bill]);
        expect(searched()).toHaveLength(3);

        for (const parsed of searched()) {
            expect(parsed).toMatchObject({ folders: ['Cabin'], types: ['receipt'] });
            expect(parsed.extractedDateRange?.start).toEqual(new Date('2025-01-01'));
        }
    });

    it('narrows the rewordings, never the user’s own search, to the model’s date when the user gave none', async () => {
        answerWith({ rewordings: ['Fortum sähkölasku'], date: { from: '2025-01-01', to: '2025-12-31' } });

        const response = await harder({ q: 'power bill' });

        expect(searched().map((parsed) => parsed.extractedDateRange?.start)).toEqual([undefined, new Date('2025-01-01')]);
        expect(ids(response)).toContain(docs.bill);
        expect(ids(response)).not.toContain(docs.older);
    });

    it('keeps the folder, media and kind narrowing of the request on every search', async () => {
        await harder({ q: 'power bill', folder_id: cabin.id, media: true, kind: 'image' });

        for (const parsed of searched()) expect(parsed).toMatchObject({ scopeFolderId: cabin.id, scopeMedia: true, scopeKind: 'image' });
    });

    it('never returns a private, locked-away, trashed or another user’s document', async () => {
        answerWith({ rewordings: ['LOCKEDWORD', 'TRASHEDWORD', 'BOBWORD', 'content'], date: null });

        const response = await harder({ q: 'secret things' });
        const hidden = [...HIDDEN_DOCS.map((key) => world().docs[key]), world().docs.bobs];

        expect(ids(response)).toContain(docs.publicTwin);
        expect(ids(response).filter((id) => hidden.includes(id))).toEqual([]);
    });

    it.each([['vault'], ['lockedFolder'], ['vaultInner']] as const)('returns nothing from inside the private folder %s', async (folder) => {
        answerWith({ rewordings: ['LOCKEDWORD'], date: null });

        expect((await harder({ q: 'secret things', folder_id: world().folders[folder].id })).results).toEqual([]);
    });

    it.each([
        ['an answer that is not JSON', () => toAnthropicAnswer('Sure! Here are some ideas')],
        ['an answer of another shape', () => toAnthropicAnswer('{"queries":["x"]}')],
        ['a refusal', () => toAnthropicAnswer('{"rewordings":[],"date":null}', 'refusal')],
        ['an API error', () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"no"}}', { status: 400 })],
    ])('answers 502 in plain words to %s', async (_, answer) => {
        h.anthropic.mockImplementation(async () => answer());

        const response = await post({ q: 'power bill' });

        expect(response.statusCode, response.body).toBe(502);
        expect(response.json()).toMatchObject({ error: 'SEARCH_PLAN_FAILED', message: expect.stringContaining('Try again') });
    });

    it('answers 503 and calls nobody when no language model is set up', async () => {
        await useSummarySettings({ 'llm.summary.provider': 'openai-compatible', 'llm.summary.baseUrl': '' });

        const response = await post({ q: 'power bill' });

        expect(response.statusCode, response.body).toBe(503);
        expect(response.json()).toMatchObject({ error: 'LLM_UNAVAILABLE' });
        expect(h.anthropic).not.toHaveBeenCalled();
    });

    it('works with a local model', async () => {
        const answer = JSON.stringify({ rewordings: ['Fortum sähkölasku'], date: null });
        const local = vi.fn(async () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }));
        vi.stubGlobal('fetch', local);
        await useSummarySettings({
            'llm.summary.provider': 'openai-compatible',
            'llm.summary.model': 'llama3.1:8b',
            'llm.summary.baseUrl': 'http://local-llm:11434/v1',
        });

        expect(ids(await harder({ q: 'power bill' }))).toContain(docs.bill);
        expect(local).toHaveBeenCalledTimes(1);
        expect(h.anthropic).not.toHaveBeenCalled();
    });

    it.each([[''], ['type:receipt'], ['folder:Cabin date:2025']])('refuses %j, which has no words to search for', async (q) => {
        const response = await post({ q });

        expect(response.statusCode, response.body).toBe(400);
        expect(h.anthropic).not.toHaveBeenCalled();
    });

    it('needs the user’s date and a signed-in user', async () => {
        expect((await post({ q: 'power bill', today: 'today' })).statusCode).toBe(400);
        expect((await post({ q: 'power bill' }, { authorization: '' })).statusCode).toBe(401);
        expect(h.anthropic).not.toHaveBeenCalled();
    });
});
