/**
 * "Search harder": when plain search misses a file, one model call turns the sentence into a few other searches,
 * each runs through the same hybrid search as /search, and their results are merged into one page of documents.
 * It runs only when the user asks, and only the free text and the date go to the model (see plan.ts).
 */
import { AppError, getFreeText, tokenizeQuery, type ParsedQuery, type SearchHarderRequest, type SearchResponse } from '@reverie/shared';
import { getProvider, isCapabilityAvailable } from '../../llm/provider-config';
import { getPrivateFolderIds } from '../../services/privacy';
import { fetchDocumentDetails } from '../document-hydration';
import { findRankedDocuments, type HybridContext, type RankedEntry } from '../hybrid-search';
import { validateQuery } from '../query-parser';
import { toDocumentHits, toScopedQuery, type SearchScope } from '../search.service';
import { toSearchQueries } from './compose';
import { mergeSearches, type MergedEntry } from './merge';
import { fetchSearchPlan, type SearchPlan } from './plan';

const RESULT_LIMIT = 24;
/** Each search embeds its words twice within a short timeout and shares the database pool with everything else. */
const CONCURRENT_SEARCHES = 2;

type RunSearch = (q: string) => Promise<RankedEntry[]>;

const toScope = (request: SearchHarderRequest): SearchScope => ({ folderId: request.folder_id, media: request.media, kind: request.kind });

function toRunSearch(scope: SearchScope, ctx: HybridContext): RunSearch {
    return async (q) => {
        const ranked = await findRankedDocuments(toScopedQuery(q, scope), ctx, {
            limit: RESULT_LIMIT,
            offset: 0,
            sortBy: 'relevance',
            sortOrder: 'desc',
        });

        return ranked.entries;
    };
}

async function runInBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];

    for (let start = 0; start < items.length; start += CONCURRENT_SEARCHES) {
        results.push(...(await Promise.all(items.slice(start, start + CONCURRENT_SEARCHES).map(run))));
    }

    return results;
}

/** The documents of `entries`, each with its snippet highlighted by the words of the query that found it. */
async function fetchHits(userId: string, entries: MergedEntry[], queries: string[], scope: SearchScope) {
    const groups = [...new Set(entries.map((entry) => entry.foundBy))];
    const details = await runInBatches(groups, (foundBy) => {
        const ids = entries.filter((entry) => entry.foundBy === foundBy).map((entry) => entry.id);

        return fetchDocumentDetails(userId, ids, toScopedQuery(queries[foundBy]!, scope));
    });

    return toDocumentHits(entries, new Map(details.flatMap((group) => [...group])));
}

/** The plan for `text`; whatever goes wrong with the model is logged and answered with one clear error. */
async function fetchPlanOrFail(text: string, today: string): Promise<SearchPlan> {
    try {
        return await fetchSearchPlan(await getProvider('summary'), text, today);
    } catch (error) {
        console.error('Search harder planning failed:', error);

        throw new AppError(502, 'SEARCH_PLAN_FAILED', 'Search harder got no usable answer from the language model. Try again.');
    }
}

/** The request's own query parsed, or a 400 when it can't be searched harder. */
function parseRequest(request: SearchHarderRequest, text: string): ParsedQuery {
    const parsed = toScopedQuery(request.q, toScope(request));
    const errors = validateQuery(parsed);

    if (errors.length > 0) throw new AppError(400, 'INVALID_QUERY', 'Invalid query: ' + errors.join(', '));

    if (!text || !parsed.fullText) throw new AppError(400, 'NOTHING_TO_SEARCH', 'Type some words to search harder for.');

    return parsed;
}

export async function searchHarder(request: SearchHarderRequest, userId: string): Promise<SearchResponse> {
    const startTime = performance.now();
    const text = getFreeText(tokenizeQuery(request.q));
    const parsed = parseRequest(request, text);

    if (!(await isCapabilityAvailable('summary'))) {
        throw new AppError(503, 'LLM_UNAVAILABLE', 'Search harder needs a language model, and none is set up on this server.');
    }

    // Private documents and folders are excluded from every search, as in /search.
    const ctx: HybridContext = { userId, privateFolderIds: await getPrivateFolderIds(userId) };
    const scope = toScope(request);
    const runSearch = toRunSearch(scope, ctx);
    // The user's own search needs nothing from the plan, so it runs while the model thinks.
    const [plan, own] = await Promise.all([fetchPlanOrFail(text, request.today), runSearch(request.q)]);
    const queries = toSearchQueries(request.q, plan);
    const rewordings = await runInBatches(queries.slice(1), runSearch);
    const results = await fetchHits(userId, mergeSearches(own, rewordings, RESULT_LIMIT), queries, scope);

    return { total: results.length, results, query: parsed, timing_ms: Math.round(performance.now() - startTime) };
}
