import { describe, expect, it } from 'vitest';
import { SearchResponseSchema } from '../api/schemas/search.js';

describe('SearchResponseSchema', () => {
    it('parses a response to a dated search as a client receives it', () => {
        const range = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' };
        const body = { total: 0, results: [], query: { extractedDateRange: range, negations: { uploadedRange: range } }, timing_ms: 1 };

        expect(SearchResponseSchema.parse(body).query?.extractedDateRange?.start).toEqual(new Date(range.start));
    });
});
