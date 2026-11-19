import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './llm-cost';

describe('estimateCostUsd', () => {
    it('prices Haiku 4.5 at $1 / $5 per million tokens', () => {
        expect(estimateCostUsd('claude-haiku-4-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.007, 8);
    });

    it('prices Haiku 5.5 at $0.10 / $0.50 per million tokens', () => {
        expect(estimateCostUsd('claude-haiku-5-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.0007, 8);
    });

    it('returns null for an unknown model instead of throwing', () => {
        expect(estimateCostUsd('claude-unknown-9', { input_tokens: 10, output_tokens: 10 })).toBeNull();
    });
});
