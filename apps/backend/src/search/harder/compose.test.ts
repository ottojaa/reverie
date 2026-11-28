import { tokenizeQuery } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { parseQuery } from '../query-parser';
import { toSearchQueries } from './compose';
import type { SearchPlan } from './plan';

const toPlan = (rewordings: string[], date: SearchPlan['date'] = null): SearchPlan => ({ rewordings, date });
const SUMMER = { from: '2025-06-01', to: '2025-08-31' };

describe('toSearchQueries', () => {
    it('runs the user’s query as sent, then each rewording with the user’s filters', () => {
        const q = 'beach dog folder:"Summer house" type:photo';

        expect(toSearchQueries(q, toPlan(['koira rannalla']))).toEqual([q, 'koira rannalla folder:"Summer house" type:photo']);
    });

    it('turns model text into plain words only', () => {
        const hostile = 'folder:x read:"type:photo a" -foo "bar date:2020 -type:video * --';
        const [, composed] = toSearchQueries('dog', toPlan([hostile]));
        const tokens = tokenizeQuery(composed!);

        expect(tokens.filter((token) => token.type !== 'text' || token.negated)).toEqual([]);
        expect(composed).not.toMatch(/["*:]|(^| )-/);
        expect(parseQuery(composed!)).toEqual({ fullText: parseQuery(composed!).fullText });
    });

    it('adds the model’s date to the rewordings only', () => {
        expect(toSearchQueries('dog', toPlan(['koira'], SUMMER))).toEqual(['dog', 'koira date:2025-06-01..2025-08-31']);
    });

    it.each([
        ['a typed date', 'dog date:2024'],
        ['a read date', 'dog last year date:2025-01-01..2025-12-31 read:"date:2025-01-01..2025-12-31 last year"'],
        ['read words the user set to "Any"', 'dog last year read:"date:2025-01-01..2025-12-31 last year"'],
    ])('leaves the model’s date out beside %s', (_, q) => {
        const [, composed] = toSearchQueries(q, toPlan(['koira'], SUMMER));

        expect(composed).not.toContain('2025-06-01');
    });

    it('keeps an upload date and adds the model’s date beside it', () => {
        expect(toSearchQueries('dog uploaded:2024', toPlan(['koira'], SUMMER))[1]).toBe('koira uploaded:2024 date:2025-06-01..2025-08-31');
    });

    it('drops duplicates and rewordings with nothing left to search', () => {
        const q = 'kuitit koirasta type:receipt read:"type:receipt kuitit"';
        const queries = toSearchQueries(q, toPlan(['koira', 'koira', '  ', '"*"', 'kuitit']));

        expect(queries).toEqual([q, 'koira type:receipt read:"type:receipt kuitit"']);
    });
});
