import type { ParsedQuery } from '@reverie/shared';
import { sql, type SqlBool } from 'kysely';
import { buildPrefixTsQuery, type SearchQueryBase } from '../search/filter-application';
import { resolveRelativeDate } from '../search/query-parser';
import { shownDateSql, withholdsImageContentSql } from './photo';

/**
 * Keeps search from confirming what the tools refuse to show. A withheld image (see photo.ts) has
 * a search vector, OCR text and summary that all come from what the picture shows, so a keyword
 * hit or a `content:` filter would say what is in it even though no output field does. For those
 * images this guard makes content-derived matches impossible:
 *
 * - content predicates (`content:`, `entity:`, `has:text`, `has:summary`, `in:content`,
 *   `in:summary`, each also negated) drop withheld images altogether;
 * - free text keeps a withheld image only when every word is in its filename, folder path, place
 *   or tags, which the tools do show;
 * - the `date:` filter reads a withheld image's capture date, not the date the model read from
 *   the picture.
 *
 * Not covered: sort order. Relevance (and date) ordering is still computed from the hidden text,
 * which reveals nothing the agent can read back.
 */

const withheld = withholdsImageContentSql();
const shownDate = shownDateSql();

function hasContentPredicate(parsed: ParsedQuery): boolean {
    const negations = parsed.negations;
    const scoped = parsed.searchScope === 'content' || parsed.searchScope === 'summary';
    const positive = Boolean(parsed.contentContains?.length || parsed.entities?.length) || parsed.hasText !== undefined || parsed.hasSummary !== undefined;
    const negated =
        Boolean(negations?.contentContains?.length || negations?.entities?.length) || negations?.hasText !== undefined || negations?.hasSummary !== undefined;

    return scoped || positive || negated;
}

/** Everything the tools show about a document in text form: filename, folder path, place, tags. */
const visibleTextVector = sql`to_tsvector('english',
    regexp_replace(d.original_filename, '[^[:alnum:]]+', ' ', 'g') || ' ' || coalesce(f.path, '') || ' ' || coalesce(pm.city, '') || ' ' || coalesce(pm.country, '') || ' ' ||
    coalesce((SELECT string_agg(t.tag, ' ') FROM document_tags t WHERE t.document_id = d.id), ''))`;

function applyDateGuard(query: SearchQueryBase, parsed: ParsedQuery): SearchQueryBase {
    const range = parsed.extractedDateRange;

    if (!range) return query;

    const { start, end } = range.relative ? resolveRelativeDate(range.relative) : range;
    const withStart = start ? query.where(sql<SqlBool>`${shownDate} >= ${start}`) : query;

    return end ? withStart.where(sql<SqlBool>`${shownDate} <= ${end}`) : withStart;
}

/** `base` with the guard's conditions added; pass the result as the base query of the search builders. */
export function applySearchGuard(base: SearchQueryBase, parsed: ParsedQuery): SearchQueryBase {
    const dated = applyDateGuard(base, parsed);

    if (hasContentPredicate(parsed)) return dated.where(sql<SqlBool>`NOT ${withheld}`);

    const tsQuery = parsed.fullText && parsed.searchScope !== 'filename' ? buildPrefixTsQuery(parsed.fullText) : null;

    if (!tsQuery) return dated;

    return dated.where(sql<SqlBool>`(NOT ${withheld} OR ${visibleTextVector} @@ ${tsQuery})`);
}

/** The query without its date range, which the guard applies itself. */
export function withoutDateRange(parsed: ParsedQuery): ParsedQuery {
    const { extractedDateRange: _dropped, ...rest } = parsed;

    return rest;
}
