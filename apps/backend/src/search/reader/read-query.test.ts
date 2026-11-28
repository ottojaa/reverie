import { getFreeText, tokenizeQuery } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { parseQuery } from '../query-parser';
import { readQuery } from './read-query';

/** A Saturday. */
const TODAY = '2026-11-28';

/** The output for a sentence: its own words, then each filter, then each filter's marker. */
function toExpected(sentence: string, ...reads: [filter: string, words: string][]): string {
    return [sentence, ...reads.map(([filter]) => filter), ...reads.map(([filter, words]) => `read:"${filter} ${words}"`)].join(' ');
}

describe('readQuery', () => {
    it.each([
        ['kuitit viime kuussa', ['type:receipt', 'kuitit'], ['date:2026-10-01..2026-10-31', 'viime kuussa']],
        ['receipts from last month', ['type:receipt', 'receipts'], ['date:2026-10-01..2026-10-31', 'from last month']],
        ['photos of the dog at the beach summer 2024', ['type:photo', 'photos of'], ['date:2024-06-01..2024-08-31', 'summer 2024']],
        ['Kuvia koirasta kesällä 2024', ['type:photo', 'Kuvia'], ['date:2024-06-01..2024-08-31', 'kesällä 2024']],
        ['kuiteista vuonna 2024', ['type:receipt', 'kuiteista'], ['date:2024', 'vuonna 2024']],
        ['screnshot from yesterday', ['type:screenshot', 'screnshot'], ['date:2026-11-27..2026-11-27', 'from yesterday']],
        ['videot viime talvena', ['type:video', 'videot'], ['date:2025-12-01..2026-02-28', 'viime talvena']],
        ['kuvakaappaukset tänä vuonna', ['type:screenshot', 'kuvakaappaukset'], ['date:2026', 'tänä vuonna']],
        ['vacation documents in 2023', ['type:document', 'documents'], ['date:2023', 'in 2023']],
        ['eilen otetut valokuvat', ['type:photo', 'valokuvat'], ['date:2026-11-27..2026-11-27', 'eilen']],
        ['lasku maaliskuussa', ['date:2026-03-01..2026-03-31', 'maaliskuussa']],
        ['kuvia viime vuoden kesältä', ['type:photo', 'kuvia'], ['date:2025-06-01..2025-08-31', 'viime vuoden kesältä']],
        ['videos from summer of last year', ['type:video', 'videos'], ['date:2025-06-01..2025-08-31', 'from summer of last year']],
        ['taxes from May', ['date:2026-05-01..2026-05-31', 'from May']],
        ['iphone 12 screenshot', ['type:screenshot', 'screenshot']],
        ['windows 2000 photos', ['type:photo', 'photos']],
        ['photos of', ['type:photo', 'photos']],
        ['"photos 2024" receipt', ['type:receipt', 'receipt']],
        ['photos tag:2024 -video', ['type:photo', 'photos']],
        ['this year may be better', ['date:2026', 'this year']],
        ['2024 may bring more', ['date:2024', '2024']],
    ] as [string, ...[string, string][]][])('%s', (sentence, ...reads) => {
        expect(readQuery(sentence, TODAY)).toBe(toExpected(sentence, ...reads));
    });

    it.each([
        // Nothing here names a type or a date
        'the dog at the beach',
        'iphone 12',
        'Windows 11',
        'version 2024',
        'node 20.19.4',
        'we may go',
        'this may be it',
        'this march was long',
        'summer cottage',
        'budget 2000 euros',
        'bill 4821',
        'trip 2031',
        'kuvaus ja kuvake',
        'pictured recipes',
        'kiitti luvassa',
        // Unsure: two candidates, or a date that isn't a whole day, month, season or year
        'photos and videos',
        'photo of a receipt',
        '2023 2024',
        '5 June 2024',
        'June 5, 2024',
        'kesäkuuta 5.',
        'since 2020',
        'after the summer of 2024',
        'vuodesta 2020 lähtien',
        'June 2031',
        // Not plain words
        '"receipts last month"',
        '-photos',
        'photos?',
        'receipts "last month',
        '',
    ])('reads nothing from %j', (sentence) => {
        expect(readQuery(sentence, TODAY)).toBe(sentence);
    });

    it('does not read a key that already has a filter, typed or negated', () => {
        expect(readQuery('photos from 2024 type:receipt', TODAY)).toBe('photos from 2024 type:receipt date:2024 read:"date:2024 from 2024"');
        expect(readQuery('photos -type:video', TODAY)).toBe('photos -type:video');
    });

    it('does not read words that already have a marker, even once their filter is gone', () => {
        const q = 'kuitit viime kuussa read:"date:2026-10-01..2026-10-31 viime kuussa"';

        expect(readQuery(q, TODAY)).toBe(q + ' type:receipt read:"type:receipt kuitit"');
    });

    it.each(['kuitit viime kuussa', 'photos of the dog at the beach summer 2024', 'iphone 12 screenshot'])(
        'reads its own answer to %j as it is',
        (sentence) => {
            const once = readQuery(sentence, TODAY);

            expect(readQuery(once, TODAY)).toBe(once);
        },
    );

    it('leaves the typed words as the free text, and searches the others', () => {
        const q = readQuery('photos of the dog at the beach summer 2024', TODAY);

        expect(getFreeText(tokenizeQuery(q))).toBe('photos of the dog at the beach summer 2024');
        expect(parseQuery(q).fullText).toBe('the dog at the beach');
    });

    it.each([
        ['2027-01-15', 'last month', '2026-12-01..2026-12-31'],
        ['2027-01-15', 'viime kuussa', '2026-12-01..2026-12-31'],
        ['2026-11-23', 'last week', '2026-11-16..2026-11-22'],
        ['2026-11-29', 'viime viikolla', '2026-11-16..2026-11-22'],
        ['2026-11-29', 'this week', '2026-11-23..2026-11-29'],
        ['2027-01-01', 'yesterday', '2026-12-31..2026-12-31'],
        ['2026-11-28', 'winter 2024', '2024-12-01..2025-02-28'],
        ['2027-01-15', 'tänä talvena', '2026-12-01..2027-02-28'],
        ['2027-01-15', 'last winter', '2025-12-01..2026-02-28'],
        ['2026-07-10', 'last summer', '2025-06-01..2025-08-31'],
        ['2028-11-01', 'winter 2027', '2027-12-01..2028-02-29'],
        ['2026-11-28', 'in November', '2026-11-01..2026-11-30'],
        ['2026-11-28', 'joulukuussa', '2025-12-01..2025-12-31'],
        ['2026-11-28', 'last November', '2025-11-01..2025-11-30'],
        ['2026-11-28', 'last May', '2026-05-01..2026-05-31'],
        ['2026-11-28', 'June of 2024', '2024-06-01..2024-06-30'],
        ['2026-11-28', 'vuoden 2024 kesäkuussa', '2024-06-01..2024-06-30'],
        ['2026-11-28', 'last year', '2025'],
    ])('on %s reads "%s" as %s', (today, words, value) => {
        expect(readQuery(words, today)).toBe(toExpected(words, ['date:' + value, words]));
    });
});
