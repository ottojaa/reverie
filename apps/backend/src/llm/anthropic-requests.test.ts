import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    parse: vi.fn(),
    env: {
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_SUMMARY_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_VISION_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_SUMMARY_EFFORT: 'low',
        LLM_MAX_OUTPUT_TOKENS: 2000,
        LLM_ENABLED: true,
        LLM_VISION_ENABLED: true,
        LLM_MAX_INPUT_CHARS: 25000,
        LLM_SNIPPET_SIZE: 3000,
        LLM_MIN_OCR_CONFIDENCE: 30,
        LLM_PROCESS_CODE_FILES: false,
    },
}));

vi.mock('../config/env', () => ({ env: h.env }));
vi.mock('../config/env.js', () => ({ env: h.env }));
// No stored settings: the registry defaults apply, which is what an untouched deploy runs on.
vi.mock('../settings/settings.store.js', () => ({
    fetchSettingRow: async () => undefined,
    fetchSettingRows: async () => [],
    upsertSettingRow: async () => undefined,
    deleteSettingRow: async () => undefined,
}));
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = { parse: h.parse };
    },
}));

import { understandImage, type PreparedImage } from './image-call';
import { buildImagePrompt } from './image-prompt';
import { analyzeOcrText } from './text-analysis';

/**
 * The request bodies sent to Anthropic by default settings, recorded before the provider seam was introduced.
 * Regenerate only on purpose, with UPDATE_ANTHROPIC_REQUESTS=1: a changed fixture means a changed request.
 */
const FIXTURE = join(__dirname, 'fixtures', 'anthropic-requests.json');

const OCR = {
    raw_text: 'Nordea statement\nAccount FI21 1234 5600 0007 85\nBalance 1 204,50 EUR\nOpening 3 Nov 2026',
    confidence_score: 91,
};
const IMAGE: PreparedImage = { base64: 'QUJD', mediaType: 'image/jpeg', width: 640, height: 480 };
const ANALYSIS = { summary: 's', title: 't', document_type: 'other', language: 'en', entities: [], topics: [], tags: [], extracted_date: null };
const IMAGE_ANSWER = { ...ANALYSIS, kind: 'screenshot', app_or_source: 'Lunamux terminal' };
const USAGE = { input_tokens: 10, output_tokens: 5 };

function record(): unknown[] {
    return h.parse.mock.calls.map((call) => JSON.parse(JSON.stringify(call[0])));
}

async function recordRequests(): Promise<Record<string, unknown[]>> {
    const bodies: Record<string, unknown[]> = {};

    for (const [name, options] of [
        ['text default', {}],
        ['text haiku-4-5', { model: 'claude-haiku-4-5' }],
        ['text effort medium', { model: 'claude-haiku-5-5', effort: 'medium' as const }],
    ] as const) {
        h.parse.mockClear();
        await analyzeOcrText({ original_filename: 'statement.pdf' }, OCR, options);
        bodies[name] = record();
    }

    for (const [name, options] of [
        ['image default', {}],
        ['image haiku-4-5', { model: 'claude-haiku-4-5' }],
        ['image effort high', { effort: 'high' as const }],
    ] as const) {
        h.parse.mockClear();
        await understandImage(IMAGE, buildImagePrompt({ filename: 'shot.png', kind: 'screenshot', ocrResult: OCR as never }), options);
        bodies[name] = record();
    }

    return bodies;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    h.parse.mockImplementation(async (body: { messages: { content: unknown }[] }) => ({
        parsed_output: Array.isArray(body.messages[0]?.content) ? IMAGE_ANSWER : ANALYSIS,
        stop_reason: 'end_turn',
        usage: USAGE,
    }));
});

describe('Anthropic request bodies with default settings', () => {
    it('are the ones recorded before the provider seam', async () => {
        const bodies = await recordRequests();

        if (process.env.UPDATE_ANTHROPIC_REQUESTS === '1') writeFileSync(FIXTURE, JSON.stringify(bodies, null, 2) + '\n');

        expect(bodies).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    });
});

describe('calls to Claude', () => {
    const recorded = (): Record<string, unknown[]> => JSON.parse(readFileSync(FIXTURE, 'utf8'));

    it('run side by side, and send the same request whatever their lane', async () => {
        const answers: (() => void)[] = [];
        h.parse.mockImplementation(
            () => new Promise((resolve) => answers.push(() => resolve({ parsed_output: ANALYSIS, stop_reason: 'end_turn', usage: USAGE }))),
        );
        const calls = (['normal', 'background', 'background'] as const).map((lane) => analyzeOcrText({ original_filename: 'statement.pdf' }, OCR, { lane }));

        await vi.waitFor(() => expect(answers).toHaveLength(3));
        answers.forEach((answer) => answer());
        await Promise.all(calls);

        expect(record()).toEqual(Array.from({ length: 3 }, () => recorded()['text default']![0]));
    });

    it('send the same image request for a background document', async () => {
        const prompt = buildImagePrompt({ filename: 'shot.png', kind: 'screenshot', ocrResult: OCR as never });

        await understandImage(IMAGE, prompt, { lane: 'background' });

        expect(record()).toEqual(recorded()['image default']);
    });
});
