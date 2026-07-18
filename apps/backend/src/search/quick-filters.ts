import type { QuickFilter } from '@reverie/shared';
import { getPrivateFolderIds } from '../services/privacy';
import { parseQuery } from './query-parser';
import { countDocuments } from './search.service';

/**
 * Data-driven quick filters: static candidates counted through the real search
 * count path, so a chip's count always equals what clicking it returns.
 * Zero-count candidates are dropped and the list is capped in candidate order.
 */

const QUICK_FILTER_CANDIDATES = [
    { id: 'photos', label: 'Photos', query: 'type:photo', icon: 'image' },
    { id: 'screenshots', label: 'Screenshots', query: 'type:screenshot', icon: 'monitor' },
    { id: 'documents', label: 'Documents', query: 'type:document', icon: 'file-text' },
    { id: 'videos', label: 'Videos', query: 'type:video', icon: 'video' },
    { id: 'receipts', label: 'Receipts', query: 'category:receipt', icon: 'receipt' },
    { id: 'statements', label: 'Statements', query: 'category:stock_statement category:bank_statement', icon: 'trending-up' },
    { id: 'recent', label: 'Recent', query: 'uploaded:last-week', icon: 'clock' },
    { id: 'large-files', label: 'Large files', query: 'size:>10MB', icon: 'hard-drive' },
    { id: 'with-summary', label: 'With summary', query: 'has:summary', icon: 'sparkles' },
    { id: 'no-text', label: 'No text', query: '-has:text', icon: 'image-off' },
] as const;

const MAX_QUICK_FILTERS = 8;

/**
 * Quick filters for a user with live counts. Deliberately uncached: the counts
 * are cheap indexed aggregates and the web client already caches the response.
 * If caching is ever needed, follow the Redis-TTL precedent in
 * services/organize-conversation.store.ts.
 */
export async function getQuickFilters(userId: string): Promise<QuickFilter[]> {
    const privateFolderIds = await getPrivateFolderIds(userId);

    const candidatesWithCounts = await Promise.all(
        QUICK_FILTER_CANDIDATES.map(async (candidate) => ({
            ...candidate,
            count: await countDocuments(parseQuery(candidate.query), userId, privateFolderIds),
        })),
    );

    return candidatesWithCounts.filter((candidate) => candidate.count > 0).slice(0, MAX_QUICK_FILTERS);
}
