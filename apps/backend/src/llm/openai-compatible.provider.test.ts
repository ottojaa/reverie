import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: { LLM_MAX_OUTPUT_TOKENS: 2000, LOCAL_LLM_API_KEY: 'sk-local-secret-123', LOCAL_LLM_TIMEOUT_MS: 5000 } }));

vi.mock('../config/env', () => ({ env: h.env }));

import { NonRetryableJobError } from '../jobs/job.types';
import { OpenAiCompatibleProvider, resetJsonModes } from './openai-compatible.provider';
import type { PreparedImage } from './provider';

const KEY = h.env.LOCAL_LLM_API_KEY;
const PROMPT = { system: 'You summarise documents.', user: 'Invoice from Acme.', maxTokens: 1500 };
const ANALYSIS = {
    summary: 'An invoice.',
    title: 'Acme invoice',
    document_type: 'invoice',
    language: 'en',
    entities: [],
    topics: ['billing'],
    tags: ['invoice'],
    extracted_date: null,
};
const IMAGE_ANSWER = {
    kind: 'screenshot',
    app_or_source: 'Lunamux terminal',
    title: 'Terminal',
    summary: 'A terminal.',
    document_type: null,
    language: 'en',
    entities: [],
    topics: [],
    tags: ['terminal'],
    extracted_date: null,
};
const IMAGE: PreparedImage = { base64: 'QUJD', mediaType: 'image/jpeg', width: 4, height: 4 };

interface Seen {
    url: string;
    authorization: string | undefined;
    body: {
        model: string;
        max_tokens: number;
        messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[];
        response_format?: { type: string; json_schema?: { name: string; strict: boolean; schema: Record<string, unknown> } };
    };
}

type Handler = (seen: Seen, res: ServerResponse, count: number) => void;

let server: Server;
let baseUrl: string;
let seen: Seen[] = [];
let handler: Handler;

const chat = (content: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 }, ...extra });

function reply(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let data = '';

        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
    });
}

beforeAll(async () => {
    server = createServer(async (req, res) => {
        const entry: Seen = { url: req.url ?? '', authorization: req.headers.authorization, body: JSON.parse(await readBody(req)) };

        seen.push(entry);
        handler(entry, res, seen.length);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
    seen = [];
    resetJsonModes();
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    handler = (_seen, res) => reply(res, 200, chat(JSON.stringify(ANALYSIS)));
});

function makeProvider(overrides: { baseUrl?: string; timeoutMs?: number; apiKey?: string | undefined } = {}) {
    return new OpenAiCompatibleProvider({ baseUrl, model: 'llama3.1:8b', apiKey: KEY, timeoutMs: 5000, ...overrides });
}

describe('JSON schema mode', () => {
    it('posts chat completions with the schema as response_format, the key as a bearer token, and no SDK', async () => {
        const out = await makeProvider().summarize(PROMPT);

        expect(seen).toHaveLength(1);
        expect(seen[0]!.url).toBe('/v1/chat/completions');
        expect(seen[0]!.authorization).toBe('Bearer ' + KEY);
        expect(seen[0]!.body.model).toBe('llama3.1:8b');
        expect(seen[0]!.body.messages).toEqual([
            { role: 'system', content: PROMPT.system },
            { role: 'user', content: PROMPT.user },
        ]);
        expect(seen[0]!.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'response', strict: true } });
        expect(seen[0]!.body.response_format!.json_schema!.schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['summary', 'tags']) });
        expect(seen[0]!.body.response_format!.json_schema!.schema).not.toHaveProperty('$schema');
        expect(out.result).toEqual(ANALYSIS);
    });

    it('sends no Authorization header without a key, and tolerates a trailing slash on the base URL', async () => {
        await makeProvider({ apiKey: undefined, baseUrl: baseUrl + '/' }).summarize(PROMPT);

        expect(seen[0]!.authorization).toBeUndefined();
        expect(seen[0]!.url).toBe('/v1/chat/completions');
    });

    it('records the tokens the server reports and no cost', async () => {
        const out = await makeProvider().summarize(PROMPT);

        expect(out.tokenCount).toBe(120);
        expect(out.call).toEqual({ model: 'llama3.1:8b', usage: { input_tokens: 100, output_tokens: 20 }, stopReason: 'stop', costUsd: null });
    });

    it('records unknown tokens, not zero, when the server reports none', async () => {
        handler = (_s, res) => reply(res, 200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALYSIS) }, finish_reason: 'stop' }] }));

        const out = await makeProvider().summarize(PROMPT);

        expect(out.tokenCount).toBeNull();
        expect(out.call.usage).toBeNull();
        expect(out.call.costUsd).toBeNull();
    });

    it('logs the call with tokens and a null cost', async () => {
        await makeProvider().summarize(PROMPT);

        expect(console.info).toHaveBeenCalledWith('[LocalLLM] text_summary cost', expect.stringContaining('"costUsd":null'));
        expect(console.info).toHaveBeenCalledWith('[LocalLLM] text_summary cost', expect.stringContaining('"inputTokens":100'));
    });

    it('reads a reply wrapped in a code fence', async () => {
        handler = (_s, res) => reply(res, 200, chat('```json\n' + JSON.stringify(ANALYSIS) + '\n```'));

        expect((await makeProvider().summarize(PROMPT)).result).toEqual(ANALYSIS);
    });
});

describe('JSON mode fallback', () => {
    it('falls back to json_object with the schema in the system prompt when the server refuses json_schema, and remembers it', async () => {
        handler = (s, res) =>
            s.body.response_format?.type === 'json_schema'
                ? reply(res, 400, JSON.stringify({ error: { message: "response_format 'json_schema' is not supported" } }))
                : reply(res, 200, chat(JSON.stringify(ANALYSIS)));

        const first = await makeProvider().summarize(PROMPT);

        expect(first.result).toEqual(ANALYSIS);
        expect(seen.map((s) => s.body.response_format?.type)).toEqual(['json_schema', 'json_object']);

        const system = seen[1]!.body.messages[0]!.content as string;

        expect(system).toContain(PROMPT.system);
        expect(system).toContain('JSON Schema');
        expect(system).toContain('"summary"');

        await makeProvider().summarize(PROMPT);

        expect(seen.map((s) => s.body.response_format?.type)).toEqual(['json_schema', 'json_object', 'json_object']);
    });

    it('also falls back on a 422', async () => {
        handler = (s, res) => (s.body.response_format?.type === 'json_schema' ? reply(res, 422, '{}') : reply(res, 200, chat(JSON.stringify(ANALYSIS))));

        await makeProvider().summarize(PROMPT);

        expect(seen.map((s) => s.body.response_format?.type)).toEqual(['json_schema', 'json_object']);
    });

    it('does not fall back on a server error', async () => {
        handler = (_s, res) => reply(res, 500, 'boom');

        await expect(makeProvider().summarize(PROMPT)).rejects.toThrow('Local LLM request failed: HTTP 500');
        expect(seen).toHaveLength(1);
    });
});

describe('repair retry', () => {
    it('asks once more with the problems fed back when the first answer is not valid, and adds up the tokens', async () => {
        handler = (_s, res, count) => reply(res, 200, chat(count === 1 ? '{"summary": 12}' : JSON.stringify(ANALYSIS)));

        const out = await makeProvider().summarize(PROMPT);

        expect(out.result).toEqual(ANALYSIS);
        expect(seen).toHaveLength(2);

        const [, , assistant, repair] = seen[1]!.body.messages;

        expect(assistant).toEqual({ role: 'assistant', content: '{"summary": 12}' });
        expect(repair!.role).toBe('user');
        expect(repair!.content).toContain('did not match the schema');
        expect(out.tokenCount).toBe(240);
    });

    it('repairs an answer that is not JSON at all', async () => {
        handler = (_s, res, count) => reply(res, 200, chat(count === 1 ? 'Sure! Here is the summary.' : JSON.stringify(ANALYSIS)));

        expect((await makeProvider().summarize(PROMPT)).result).toEqual(ANALYSIS);
        expect(seen[1]!.body.messages.at(-1)!.content).toContain('not valid JSON');
    });

    it('takes a server that ignores response_format the same way: validation and the one retry', async () => {
        handler = (_s, res, count) => reply(res, 200, chat(count === 1 ? '```json\n{"nope": true}\n```' : JSON.stringify(ANALYSIS)));

        expect((await makeProvider().summarize(PROMPT)).result).toEqual(ANALYSIS);
        expect(seen).toHaveLength(2);
    });

    it('gives a plain, retryable error for a summary that is still invalid after the repair', async () => {
        handler = (_s, res) => reply(res, 200, chat('{"summary": 12}'));

        const error = await makeProvider()
            .summarize(PROMPT)
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(NonRetryableJobError);
        expect((error as Error).message).toBe('Local LLM gave no usable answer: stop');
        expect(seen).toHaveLength(2);
    });
});

describe('images', () => {
    const IMAGE_PROMPT = { system: 'You read images.', user: 'OCR text: hello', maxTokens: 1500 };

    beforeEach(() => {
        handler = (_s, res) => reply(res, 200, chat(JSON.stringify(IMAGE_ANSWER)));
    });

    it('sends the prompt and the image as a base64 data URL content part', async () => {
        const out = await makeProvider().understand(IMAGE, IMAGE_PROMPT);

        expect(seen[0]!.body.messages[1]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: IMAGE_PROMPT.user },
                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
            ],
        });
        expect(seen[0]!.body.response_format!.json_schema!.schema).toMatchObject({ required: expect.arrayContaining(['kind', 'app_or_source']) });
        expect(out.result).toEqual(IMAGE_ANSWER);
        expect(console.info).toHaveBeenCalledWith('[LocalLLM] image_understanding cost', expect.stringContaining('"costUsd":null'));
    });

    it('ends without a retry when the model declines or is cut off', async () => {
        handler = (_s, res) =>
            reply(res, 200, JSON.stringify({ choices: [{ message: { content: '', refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] }));
        await expect(makeProvider().understand(IMAGE, IMAGE_PROMPT)).rejects.toBeInstanceOf(NonRetryableJobError);
        expect(seen).toHaveLength(1);

        seen = [];
        handler = (_s, res) => reply(res, 200, JSON.stringify({ choices: [{ message: { content: '{"kind": "scr' }, finish_reason: 'length' }] }));
        await expect(makeProvider().understand(IMAGE, IMAGE_PROMPT)).rejects.toBeInstanceOf(NonRetryableJobError);
        expect(seen).toHaveLength(1);
    });

    it('ends without a retry on an answer that is still invalid after the repair', async () => {
        handler = (_s, res) => reply(res, 200, chat('{"kind": "photo"}'));

        await expect(makeProvider().understand(IMAGE, IMAGE_PROMPT)).rejects.toBeInstanceOf(NonRetryableJobError);
        expect(seen).toHaveLength(2);
    });

    it('a ping can carry an image too', async () => {
        handler = (_s, res) => reply(res, 200, chat(' red '));

        expect(await makeProvider().ping({ text: 'What colour?', image: IMAGE })).toBe('red');
        expect(seen[0]!.body.response_format).toBeUndefined();
        expect(seen[0]!.body.max_tokens).toBe(64);
    });
});

describe('errors end as the failed or retry state', () => {
    it('times out as a plain Error the queue retries', async () => {
        handler = () => undefined;

        const error = await makeProvider({ timeoutMs: 150 })
            .summarize(PROMPT)
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(NonRetryableJobError);
        expect((error as Error).message).toBe('Local LLM request timed out: 150 ms');
    });

    it('names the cause when the server is not there', async () => {
        const dead = createServer();

        await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));

        const port = (dead.address() as AddressInfo).port;

        await new Promise<void>((resolve) => dead.close(() => resolve()));

        await expect(makeProvider({ baseUrl: 'http://127.0.0.1:' + port + '/v1' }).summarize(PROMPT)).rejects.toThrow(
            /Local LLM request failed: .*ECONNREFUSED/,
        );
    });

    it('fails an image call on a server error with the same plain error, so the queue retries it as today', async () => {
        handler = (_s, res) => reply(res, 503, 'loading model');

        await expect(makeProvider().understand(IMAGE, { system: 's', user: 'u', maxTokens: 500 })).rejects.toThrow(
            'Local LLM request failed: HTTP 503 loading model',
        );
    });

    it('rejects a reply that is not a chat completion', async () => {
        handler = (_s, res) => reply(res, 200, '{"hello": "world"}');

        await expect(makeProvider().summarize(PROMPT)).rejects.toThrow('Local LLM sent an unexpected reply');
    });
});

describe('the API key', () => {
    it('never appears in an error, even when the server echoes it back', async () => {
        handler = (s, res) => reply(res, 401, 'Invalid token ' + s.authorization + ' for ' + KEY);

        const error = (await makeProvider()
            .summarize(PROMPT)
            .catch((e: unknown) => e)) as Error;

        expect(error.message).toContain('HTTP 401');
        expect(error.message).not.toContain(KEY);
        expect(error.message).toContain('[redacted]');
    });

    it('never appears in the logs of a successful or a failed call', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await makeProvider().summarize(PROMPT);
        handler = (_s, res) => reply(res, 200, chat('not json'));
        await makeProvider()
            .summarize(PROMPT)
            .catch(() => undefined);

        const logged = JSON.stringify([vi.mocked(console.info).mock.calls, warn.mock.calls, error.mock.calls]);

        expect(logged).not.toContain(KEY);
    });

    it('is redacted from the Test connection reply', async () => {
        handler = (_s, res) => reply(res, 200, chat('echo ' + KEY));

        // A model that repeats a secret it was given is the server's doing; the reply shown in the admin must still not carry it.
        expect(await makeProvider().ping({ text: 'hi' })).not.toContain(KEY);
    });
});
