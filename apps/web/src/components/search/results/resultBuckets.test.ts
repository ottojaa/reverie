import type { SearchSortBy } from '@/routes/search';
import type { SearchHit } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { toBuckets } from './resultBuckets';

const now = new Date('2026-11-28T12:00:00Z');

function documentHit(id: string, extractedDate: string | null, uploadedAt: string): SearchHit {
    return { result_type: 'document', document_id: id, extracted_date: extractedDate, uploaded_at: uploadedAt } as SearchHit;
}

// In the server's order for a newest-first date sort: dated documents, then undated ones.
const datedNewestFirst = [
    documentHit('today', '2026-11-28', '2026-11-28T09:00:00Z'),
    documentHit('week', '2026-11-24', '2026-11-24T09:00:00Z'),
    documentHit('2024', '2024-06-01', '2026-01-10T09:00:00Z'),
    documentHit('2019', '2019-03-15', '2026-01-10T09:00:00Z'),
];
// Their upload dates fall in buckets that the dated documents also use.
const undatedNewestFirst = [documentHit('undated-new', null, '2026-11-25T09:00:00Z'), documentHit('undated-old', null, '2024-02-01T09:00:00Z')];

function summarise(results: SearchHit[], sortBy: SearchSortBy) {
    return toBuckets(results, sortBy, now).map((bucket) => [
        bucket.label,
        bucket.items.map(({ hit }) => (hit.result_type === 'document' ? hit.document_id : hit.id)),
    ]);
}

describe('toBuckets in a date sort', () => {
    it('ends a newest-first list with one "No date" group', () => {
        expect(summarise([...datedNewestFirst, ...undatedNewestFirst], 'date')).toEqual([
            ['Today', ['today']],
            ['This week', ['week']],
            ['2024', ['2024']],
            ['2019', ['2019']],
            ['No date', ['undated-new', 'undated-old']],
        ]);
    });

    it('ends an oldest-first list with one "No date" group', () => {
        const results = [...datedNewestFirst.toReversed(), ...undatedNewestFirst.toReversed()];

        expect(summarise(results, 'date')).toEqual([
            ['2019', ['2019']],
            ['2024', ['2024']],
            ['This week', ['week']],
            ['Today', ['today']],
            ['No date', ['undated-old', 'undated-new']],
        ]);
    });

    it('keeps each hit’s position in the whole list', () => {
        const buckets = toBuckets([...datedNewestFirst, ...undatedNewestFirst], 'date', now);

        expect(buckets.flatMap((bucket) => bucket.items.map((item) => item.index))).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe('toBuckets in other sorts', () => {
    it('groups an upload-date sort by upload date, dated or not', () => {
        const results = [documentHit('undated', null, '2026-11-28T09:00:00Z'), documentHit('dated', '2019-03-15', '2024-02-01T09:00:00Z')];

        expect(summarise(results, 'uploaded')).toEqual([
            ['Today', ['undated']],
            ['2024', ['dated']],
        ]);
    });

    it.each(['relevance', 'filename', 'size'] as const)('gives a %s sort no headers', (sortBy) => {
        expect(summarise([...datedNewestFirst, ...undatedNewestFirst], sortBy)).toEqual([
            [null, ['today', 'week', '2024', '2019', 'undated-new', 'undated-old']],
        ]);
    });

    it('gives a date sort that includes a folder no headers', () => {
        const folder = { result_type: 'collection', id: 'folder' } as SearchHit;

        expect(summarise([folder, ...undatedNewestFirst], 'date')).toEqual([[null, ['folder', 'undated-new', 'undated-old']]]);
    });
});
