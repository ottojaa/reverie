import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getProvider: vi.fn() }));

vi.mock('./provider-config', () => ({ getProvider: h.getProvider }));

import type { LlmProvider } from './provider';
import { analyzeOcrText } from './text-analysis';

const RESULT = {
    summary: 'A receipt.',
    title: 'Receipt',
    document_type: 'receipt',
    language: 'en',
    entities: [],
    topics: [],
    tags: ['receipt'],
    extracted_date: null,
};

function fakeProvider(): LlmProvider {
    return {
        summarize: vi.fn().mockResolvedValue({
            result: RESULT,
            tokenCount: 15,
            call: { model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5 }, stopReason: 'end_turn', costUsd: 0.001 },
        }),
        understand: vi.fn(),
        ping: vi.fn(),
    };
}

describe('analyzeOcrText', () => {
    it('uses the configured summary provider by default', async () => {
        const configured = fakeProvider();

        h.getProvider.mockResolvedValue(configured);
        await analyzeOcrText({ original_filename: 'a.png' }, { raw_text: 'Total 12.00', confidence_score: 90 });

        expect(h.getProvider).toHaveBeenCalledWith('summary');
        expect(configured.summarize).toHaveBeenCalledOnce();
    });

    it('uses a given provider without reading the settings', async () => {
        h.getProvider.mockClear();

        const given = fakeProvider();
        const analysis = await analyzeOcrText(
            { original_filename: 'a.png' },
            { raw_text: 'Total 12.00', confidence_score: 90 },
            { model: 'claude-haiku-4-5' },
            given,
        );

        expect(h.getProvider).not.toHaveBeenCalled();
        expect(given.summarize).toHaveBeenCalledWith(expect.anything(), { model: 'claude-haiku-4-5' });
        expect(analysis.tokenCount).toBe(15);
    });
});
