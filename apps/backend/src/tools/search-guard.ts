import type { ParsedQuery } from '@reverie/shared';
import { sql, type SqlBool } from 'kysely';
import { buildPrefixTsQuery, type SearchQueryBase } from '../search/filter-application';
import { withholdsImageContentSql } from './photo';

/**
 * Keeps search from confirming what the tools refuse to show. A withheld image (see photo.ts) has
 * a search vector, OCR text and summary that all come from what the picture shows, so a keyword
 * hit or a `content:` filter would say what is in it even though no output field does. For those
 * images this guard makes content-derived matches impossible:
 *
 * - content predicates (`content:`, `entity:`, `has:text`, `has:summary`, `in:content`,
 *   `in:summary`, each also negated) drop withheld images altogether;
 * - free text keeps a withheld image only when every word is in its filename, folder path, place
 *   or tags, which the tools do show.
 *
 * The `date:` filter and the date sort need no guard: search reads a withheld image's capture date, never the date
 * the model read from the picture (see shownDateSql).
 *
 * Meaning search is stricter (see applySemanticGuard). Not covered: sort order. Relevance ordering is still computed
 * from the hidden text, which reveals nothing the agent can read back.
 */

const withheld = withholdsImageContentSql();

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

/** `base` with the guard's conditions added; pass the result as the base query of the search builders. */
export function applySearchGuard(base: SearchQueryBase, parsed: ParsedQuery): SearchQueryBase {
    if (hasContentPredicate(parsed)) return base.where(sql<SqlBool>`NOT ${withheld}`);

    const tsQuery = parsed.fullText && parsed.searchScope !== 'filename' ? buildPrefixTsQuery(parsed.fullText) : null;

    if (!tsQuery) return base;

    return base.where(sql<SqlBool>`(NOT ${withheld} OR ${visibleTextVector} @@ ${tsQuery})`);
}

/**
 * The guard for the meaning streams and for similar images. A meaning match says "this picture looks like
 * your words", which confirms what a withheld image shows as surely as a keyword hit would, and no visible
 * text can excuse it. So withheld images never take part, whatever the query.
 */
export function applySemanticGuard(base: SearchQueryBase): SearchQueryBase {
    return base.where(sql<SqlBool>`NOT ${withheld}`);
}
