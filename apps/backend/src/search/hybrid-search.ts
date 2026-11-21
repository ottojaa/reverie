import type { MatchKind, ParsedQuery } from '@reverie/shared';
import { sql } from 'kysely';
import { buildPrefixTsQuery, documentJoins, type SearchQueryBase } from './filter-application';
import { buildCountQuery, buildSearchQuery, type SearchQueryOptions } from './query-builder';
import { fuseRankings, getSemanticSearch, type SemanticMatches, type SemanticScope } from './semantic-rank';

/**
 * The one place that decides which documents a search returns, in which order, and how many there are.
 * The web search and the agent's `search_documents` tool both call it, so they rank and page alike.
 *
 * - `sort_by: relevance` (newest-last aside): full-text matches and the two meaning streams are fused by
 *   reciprocal-rank fusion (semantic-rank.ts). Full text is read to a fixed depth, never to
 *   `offset + limit`, so a document's fused rank does not depend on which page was asked for. Full-text
 *   matches deeper than that follow the fused list in word-rank order.
 * - Any other sort keeps its SQL order. Meaning matches join the set and sort like everything else.
 * - Without meaning matches (no free text, ML off or slow) it is today's full-text query.
 *
 * `total` is the size of the result set: every word match plus the meaning matches that no word matches,
 * and the meaning streams are capped (top-K above the floor), so it is a bounded number, not "everything
 * remotely similar".
 */

export interface HybridContext extends SemanticScope {
    /** The documents query full-text starts from; defaults to all documents. The agent's search passes a guarded one. */
    fullTextBase?: SearchQueryBase;
}

export interface RankedEntry {
    id: string;
    /** ts_rank of the words, 0 for a document only the meaning found. */
    wordRank: number;
    createdAt: number;
    /** Why it matched; null when meaning search was not used for this query. */
    match: MatchKind | null;
}

export interface RankedDocuments {
    entries: RankedEntry[];
    total: number;
    semantic: SemanticMatches;
}

interface PageRow {
    id: string;
    created_at: Date;
    word_rank: number;
    word_match: boolean;
}

const toEntry = (row: PageRow, match: MatchKind | null): RankedEntry => ({
    id: row.id,
    wordRank: Number(row.word_rank),
    createdAt: row.created_at.getTime(),
    match,
});

/** One page of documents in SQL order, with their word rank and whether the words match. */
async function fetchPage(
    base: SearchQueryBase,
    parsed: ParsedQuery,
    ctx: HybridContext,
    options: SearchQueryOptions,
    alsoMatchIds?: readonly string[],
): Promise<PageRow[]> {
    const tsQuery = parsed.fullText ? buildPrefixTsQuery(parsed.fullText) : null;
    const wordRank = tsQuery ? sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)` : sql<number>`0`;
    const wordMatch = tsQuery ? sql<boolean>`d.search_vector @@ ${tsQuery}` : sql<boolean>`true`;

    return (await buildSearchQuery(base, parsed, ctx.userId, options, ctx.privateFolderIds, alsoMatchIds)
        .select(['d.id', 'd.created_at', wordRank.as('word_rank'), wordMatch.as('word_match')])
        .execute()) as PageRow[];
}

async function countMatches(parsed: ParsedQuery, ctx: HybridContext, alsoMatchIds?: readonly string[]): Promise<number> {
    const row = await buildCountQuery(ctx.fullTextBase ?? documentJoins(), parsed, ctx.userId, ctx.privateFolderIds, alsoMatchIds).executeTakeFirst();

    return row?.count ?? 0;
}

function toMatchKind(semantic: ReadonlySet<string>, row: PageRow): MatchKind {
    if (!semantic.has(row.id)) return 'keywords';

    return row.word_match ? 'both' : 'meaning';
}

/** Today's query: no meaning matches, so nothing to fuse. */
async function rankByWords(parsed: ParsedQuery, ctx: HybridContext, options: SearchQueryOptions, semantic: SemanticMatches): Promise<RankedDocuments> {
    const [rows, total] = await Promise.all([fetchPage(ctx.fullTextBase ?? documentJoins(), parsed, ctx, options), countMatches(parsed, ctx)]);
    const match = semantic.active ? 'keywords' : null;

    return { entries: rows.map((row) => toEntry(row, match)), total, semantic };
}

/** Other sorts: the meaning matches join the set through `alsoMatchIds` and sort like any other row. */
async function rankInSqlOrder(parsed: ParsedQuery, ctx: HybridContext, options: SearchQueryOptions, semantic: SemanticMatches): Promise<RankedDocuments> {
    const [rows, total] = await Promise.all([
        fetchPage(ctx.fullTextBase ?? documentJoins(), parsed, ctx, options, semantic.ids),
        countMatches(parsed, ctx, semantic.ids),
    ]);
    const meaning = new Set(semantic.ids);

    return { entries: rows.map((row) => toEntry(row, toMatchKind(meaning, row))), total, semantic };
}

/** Word matches among `ids` that sit deeper than the full-text depth, with their word rank. */
async function fetchDeepWordMatches(parsed: ParsedQuery, ctx: HybridContext, ids: string[]): Promise<PageRow[]> {
    const base = (ctx.fullTextBase ?? documentJoins()).where('d.id', 'in', ids);

    return fetchPage(base, parsed, ctx, { limit: ids.length, offset: 0, sortBy: 'relevance', sortOrder: 'desc' });
}

/** Word matches beyond the fused list, in word-rank order, for the part of the page the fused list doesn't cover. */
async function fetchTail(parsed: ParsedQuery, ctx: HybridContext, options: SearchQueryOptions, headIds: string[]): Promise<PageRow[]> {
    const offset = Math.max(0, options.offset - headIds.length);
    const limit = options.offset + options.limit - Math.max(headIds.length, options.offset);

    if (limit <= 0) return [];

    const base = (ctx.fullTextBase ?? documentJoins()).where('d.id', 'not in', headIds);

    return fetchPage(base, parsed, ctx, { limit, offset, sortBy: 'relevance', sortOrder: 'desc' });
}

/**
 * Relevance order with meaning: the fused list ("head") is full text to `fullTextDepth` plus the meaning
 * matches; word matches deeper than the head follow it ("tail"). A meaning match that the words also match but
 * that sits below the depth counts as a word match without a full-text rank. Nothing appears twice.
 */
async function rankFused(parsed: ParsedQuery, ctx: HybridContext, options: SearchQueryOptions, semantic: SemanticMatches): Promise<RankedDocuments> {
    const base = ctx.fullTextBase ?? documentJoins();
    const [fullTextRows, wordTotal] = await Promise.all([
        fetchPage(base, parsed, ctx, { limit: semantic.fullTextDepth, offset: 0, sortBy: 'relevance', sortOrder: 'desc' }),
        countMatches(parsed, ctx),
    ]);
    const known = new Map(fullTextRows.map((row) => [row.id, row]));
    const unlisted = semantic.ids.filter((id) => !known.has(id));
    const deepRows = unlisted.length ? await fetchDeepWordMatches(parsed, ctx, unlisted) : [];
    const wordMatches = new Set([...known.keys(), ...deepRows.map((row) => row.id)]);

    for (const row of deepRows) known.set(row.id, row);

    const meaning = new Set(semantic.ids);
    const headIds = fuseRankings({ fullText: fullTextRows.map((row) => row.id), text: semantic.text, image: semantic.image }, wordMatches);

    const toHeadEntry = (id: string): RankedEntry => {
        const row = known.get(id);
        const match: MatchKind = meaning.has(id) ? (wordMatches.has(id) ? 'both' : 'meaning') : 'keywords';

        return row ? toEntry(row, match) : { id, wordRank: 0, createdAt: 0, match };
    };

    const head = headIds.slice(options.offset, options.offset + options.limit).map(toHeadEntry);
    const tailRows = wordTotal > wordMatches.size ? await fetchTail(parsed, ctx, options, headIds) : [];

    return {
        entries: [...head, ...tailRows.map((row) => toEntry(row, 'keywords'))],
        total: wordTotal + semantic.ids.filter((id) => !wordMatches.has(id)).length,
        semantic,
    };
}

/**
 * The documents a search returns for `options`, in order, with how many there are in all.
 * Pass `semantic` when the caller needs the matches itself (facets); otherwise they are loaded here.
 */
export async function findRankedDocuments(
    parsed: ParsedQuery,
    ctx: HybridContext,
    options: SearchQueryOptions,
    semantic?: SemanticMatches,
): Promise<RankedDocuments> {
    const matches = semantic ?? (await getSemanticSearch().load(parsed, ctx));

    if (!matches.ids.length) return rankByWords(parsed, ctx, options, matches);

    if (options.sortBy === 'relevance' && options.sortOrder === 'desc') return rankFused(parsed, ctx, options, matches);

    return rankInSqlOrder(parsed, ctx, options, matches);
}
