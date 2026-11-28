import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '../../llm/provider';
import { fetchSearchPlan } from './plan';

function answering(value: unknown): LlmProvider {
    return { completeJson: vi.fn(async () => ({ value })) } as unknown as LlmProvider;
}

const planFor = (value: unknown) => fetchSearchPlan(answering(value), 'dog', '2026-11-28');

describe('fetchSearchPlan', () => {
    it('keeps at most five rewordings of a bounded length', async () => {
        const { rewordings } = await planFor({ rewordings: ['x'.repeat(500), 'b', 'c', 'd', 'e', 'f', 'g'], date: null });

        expect(rewordings).toHaveLength(5);
        expect(rewordings[0]).toHaveLength(200);
    });

    it('keeps a date of two real days in order', async () => {
        const date = { from: '2024-02-29', to: '2024-02-29' };

        expect((await planFor({ rewordings: [], date })).date).toEqual(date);
    });

    it.each([
        ['2025-02-29', '2025-03-01'],
        ['2025-01-01', '2025-13-01'],
        ['2025-06-01', '2025-05-01'],
        ['last summer', '2025-08-31'],
        ['2025', '2025'],
    ])('drops the date %s..%s and keeps the rewordings', async (from, to) => {
        expect(await planFor({ rewordings: ['koira'], date: { from, to } })).toEqual({ rewordings: ['koira'], date: null });
    });
});
