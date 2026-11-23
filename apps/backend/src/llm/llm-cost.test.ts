import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './llm-cost';

describe('estimateCostUsd', () => {
    it('prices Haiku 4.5 at $1 / $5 per million tokens', () => {
        expect(estimateCostUsd('claude-haiku-4-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.007, 8);
    });

    it('prices Haiku 5.5 at $0.10 / $0.50 per million tokens', () => {
        expect(estimateCostUsd('claude-haiku-5-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.0007, 8);
    });

    it('prices Sonnet 5.5 at $2 / $10 per million tokens', () => {
        expect(estimateCostUsd('claude-sonnet-5-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.014, 8);
    });

    it('prices Opus 5.5 at $4 / $20 per million tokens', () => {
        expect(estimateCostUsd('claude-opus-5-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.028, 8);
    });

    it('returns null for a family with no rate row, even when a priced model shares its start', () => {
        expect(estimateCostUsd('claude-sonnet-4-6', { input_tokens: 10, output_tokens: 10 })).toBeNull();
    });

    it('returns null for an unknown model instead of throwing', () => {
        expect(estimateCostUsd('claude-unknown-9', { input_tokens: 10, output_tokens: 10 })).toBeNull();
    });
});
