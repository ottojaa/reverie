import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    parse: vi.fn(),
    create: vi.fn(),
    env: {
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_SUMMARY_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_VISION_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_SUMMARY_EFFORT: 'low',
        LLM_MAX_OUTPUT_TOKENS: 2000,
    },
}));

vi.mock('../config/env', () => ({ env: h.env }));
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = { parse: h.parse, create: h.create };
    },
}));

import { describeImage, summarizeDocument } from './anthropic.client';

const PROMPT = { system: 'sys', user: 'doc text', maxTokens: 2000 };
const USAGE = { input_tokens: 10, output_tokens: 5 };
const ANALYSIS = { summary: 's', title: 't', document_type: 'other', language: 'en', entities: [], topics: [], tags: [], extracted_date: null };

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    h.parse.mockResolvedValue({ parsed_output: ANALYSIS, stop_reason: 'end_turn', usage: USAGE });
    h.create.mockResolvedValue({
        content: [{ type: 'text', text: '{"description":"d","detected_objects":[],"scene_type":"other","has_people":false}' }],
        stop_reason: 'end_turn',
        usage: USAGE,
    });
});

describe('summarizeDocument request', () => {
    it('sends effort and thinking headroom to Haiku 5.5, and no sampling parameters', async () => {
        await summarizeDocument(PROMPT, { model: 'claude-haiku-5-5' });

        const body = h.parse.mock.calls[0]?.[0];

        expect(body.model).toBe('claude-haiku-5-5');
        expect(body.max_tokens).toBe(10000);
        expect(body.output_config.effort).toBe('low');
        expect(body).not.toHaveProperty('temperature');
        expect(body).not.toHaveProperty('top_p');
        expect(body).not.toHaveProperty('top_k');
    });

    it('sends neither effort nor headroom to Haiku 4.5, which rejects effort', async () => {
        await summarizeDocument(PROMPT, { model: 'claude-haiku-4-5' });

        const body = h.parse.mock.calls[0]?.[0];

        expect(body.max_tokens).toBe(2000);
        expect(body.output_config).not.toHaveProperty('effort');
        expect(body).not.toHaveProperty('temperature');
    });

    it('lets the caller override the effort on Haiku 5.5', async () => {
        await summarizeDocument(PROMPT, { model: 'claude-haiku-5-5', effort: 'medium' });

        expect(h.parse.mock.calls[0]?.[0].output_config.effort).toBe('medium');
    });
});

describe('describeImage request', () => {
    it('sends effort and headroom on Haiku 5.5, and no sampling parameters', async () => {
        await describeImage('Zm9v', 'image/png', 'describe');

        const body = h.create.mock.calls[0]?.[0];

        expect(body.max_tokens).toBe(9000);
        expect(body.output_config).toEqual({ effort: 'low' });
        expect(body).not.toHaveProperty('temperature');
    });

    it('sends no output_config and no headroom on Haiku 4.5', async () => {
        h.env.ANTHROPIC_VISION_MODEL = 'claude-haiku-4-5';

        await describeImage('Zm9v', 'image/png', 'describe');
        h.env.ANTHROPIC_VISION_MODEL = 'claude-haiku-5-5';

        const body = h.create.mock.calls[0]?.[0];

        expect(body.max_tokens).toBe(1000);
        expect(body).not.toHaveProperty('output_config');
    });
});
