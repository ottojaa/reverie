import type { SearchSortBy } from '@/routes/search';
import type { DocumentSearchResult, SearchHit } from '@reverie/shared';

interface ResultBucket {
    label: string | null;
    items: Array<{ hit: SearchHit; index: number }>;
}

function getDateBucket(iso: string, now: Date): string {
    const date = new Date(iso);
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000);

    if (diffDays < 0) return date.getFullYear() === now.getFullYear() ? 'Today' : String(date.getFullYear());

    if (diffDays === 0) return 'Today';

    if (diffDays === 1) return 'Yesterday';

    if (diffDays < 7) return 'This week';

    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'This month';

    if (date.getFullYear() === now.getFullYear()) return 'This year';

    return String(date.getFullYear());
}

function getHeader(hit: DocumentSearchResult, sortBy: 'uploaded' | 'date', now: Date): string {
    if (sortBy === 'uploaded') return getDateBucket(hit.uploaded_at, now);

    // A date sort lists documents with no shown date last: their upload date would repeat headers from the dated ones.
    if (!hit.extracted_date) return 'No date';

    return getDateBucket(hit.extracted_date, now);
}

/** Date-bucket headers only make sense for date sorts over documents-only pages. */
export function toBuckets(results: SearchHit[], sortBy: SearchSortBy, now = new Date()): ResultBucket[] {
    const indexed = results.map((hit, index) => ({ hit, index }));
    const documentsOnly = results.every((hit) => hit.result_type === 'document');

    if ((sortBy !== 'uploaded' && sortBy !== 'date') || !documentsOnly) return [{ label: null, items: indexed }];

    const buckets: ResultBucket[] = [];

    for (const item of indexed) {
        if (item.hit.result_type !== 'document') continue;

        const label = getHeader(item.hit, sortBy, now);
        const current = buckets.at(-1);

        if (current && current.label === label) {
            current.items.push(item);
            continue;
        }

        buckets.push({ label, items: [item] });
    }

    return buckets;
}
