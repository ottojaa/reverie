/**
 * Token-level parser/serializer for the search query DSL.
 *
 * This is the single grammar definition shared by the web filter UI and the
 * backend query parser. It deals ONLY in tokens — semantic interpretation
 * (date ranges, size math, type→category expansion) stays backend-side.
 *
 * Grammar (must stay identical to the backend's semantic parser expectations):
 * - Tokens are whitespace-separated.
 * - A leading `-` negates the token (`-has:text`, `-type:photo`).
 * - `"..."` is quoted free text; an unterminated quote consumes to end-of-string.
 * - `key:value` is a filter; the key is lowercased. Values may be quoted to
 *   contain whitespace (`entity:"John Smith"`).
 * - Unknown filter keys are treated as free text by the backend (see
 *   `isKnownFilter`), so they round-trip as filter tokens here but count as
 *   free text in `getFreeText`.
 * - There are no comma lists: repeated tokens express multiple values.
 *   Semantics note (backend-defined, not encoded in tokens): repeated
 *   `category:`/`type:`/`format:` are OR, repeated `tag:` are AND.
 * - Date and size values are opaque strings at this level
 *   (`uploaded:2024-01..2024-06`, `uploaded:last-week`, `size:>10MB`).
 * - A bare `*` means match-all and is excluded from free text.
 */

export const FILTER_KEYS = ['in', 'type', 'format', 'category', 'uploaded', 'date', 'folder', 'has', 'size', 'tag', 'entity', 'company', 'location'] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export interface QueryToken {
    type: 'text' | 'quoted' | 'filter';
    /** Unquoted value ('' for an empty filter value like `tag:`). */
    value: string;
    /** Lowercased filter key; present only when type === 'filter'. */
    key?: string;
    negated: boolean;
    /** Exact source slice (including `-` prefix and quotes) — enables lossless removal. */
    raw: string;
}

const WHITESPACE = /\s/;

function isWhitespace(char: string | undefined): boolean {
    return char !== undefined && WHITESPACE.test(char);
}

/** Tokenize a query string. Mirrors the backend tokenizer exactly. */
export function tokenizeQuery(query: string): QueryToken[] {
    const tokens: QueryToken[] = [];
    const chars = Array.from(query);
    let i = 0;

    while (i < chars.length) {
        while (isWhitespace(chars[i])) i++;

        if (i >= chars.length) break;

        const start = i;
        const negated = chars[i] === '-';

        if (negated) i++;

        // Quoted free text: "beach sunset"
        if (chars[i] === '"') {
            i++;
            let value = '';

            while (i < chars.length && chars[i] !== '"') {
                value += chars[i] ?? '';
                i++;
            }

            i++; // Skip closing quote (no-op at end-of-string)
            tokens.push({ type: 'quoted', value, negated, raw: chars.slice(start, i).join('') });
            continue;
        }

        let word = '';

        while (i < chars.length && !isWhitespace(chars[i])) {
            word += chars[i] ?? '';
            i++;
        }

        const colonIndex = word.indexOf(':');

        if (colonIndex <= 0) {
            tokens.push({ type: 'text', value: word, negated, raw: chars.slice(start, i).join('') });
            continue;
        }

        const key = word.slice(0, colonIndex).toLowerCase();
        let value = word.slice(colonIndex + 1);

        if (value.startsWith('"') && !value.endsWith('"')) {
            // Multi-word quoted value: entity:"John Smith" — consume until closing quote
            value = value.slice(1);

            while (i < chars.length && chars[i - 1] !== '"') {
                const current = chars[i] ?? '';

                if (isWhitespace(current)) {
                    value += current;
                    i++;
                    continue;
                }

                while (i < chars.length && !isWhitespace(chars[i]) && chars[i] !== '"') {
                    value += chars[i] ?? '';
                    i++;
                }

                if (chars[i] === '"') {
                    i++;
                    break;
                }
            }
        } else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }

        tokens.push({ type: 'filter', key, value, negated, raw: chars.slice(start, i).join('') });
    }

    return tokens;
}

function toCanonicalRaw(token: Omit<QueryToken, 'raw'>): string {
    const prefix = token.negated ? '-' : '';

    if (token.type === 'quoted') return `${prefix}"${token.value}"`;

    if (token.type === 'filter') {
        const value = WHITESPACE.test(token.value) ? `"${token.value}"` : token.value;

        return `${prefix}${token.key}:${value}`;
    }

    return `${prefix}${token.value}`;
}

/** Serialize tokens back to a query string, preserving original spelling via `raw`. */
export function serializeQuery(tokens: QueryToken[]): string {
    return tokens
        .map((token) => token.raw || toCanonicalRaw(token))
        .filter((part) => part.length > 0)
        .join(' ');
}

/** Whether a filter token uses a key the backend understands. */
export function isKnownFilter(token: QueryToken): boolean {
    return token.type === 'filter' && (FILTER_KEYS as readonly string[]).includes(token.key ?? '');
}

function isFreeTextToken(token: QueryToken): boolean {
    if (token.type === 'filter') return !isKnownFilter(token);

    return !(token.type === 'text' && token.value === '*');
}

/** The free-text portion of the query (text, quoted, and unknown-key tokens). */
export function getFreeText(tokens: QueryToken[]): string {
    return serializeQuery(tokens.filter(isFreeTextToken));
}

/** Filter tokens with known keys, optionally restricted to one key. */
export function getFilterTokens(tokens: QueryToken[], key?: FilterKey): QueryToken[] {
    const known = tokens.filter(isKnownFilter);

    if (!key) return known;

    return known.filter((token) => token.key === key);
}

function buildFilterToken(key: FilterKey, value: string, negated: boolean): QueryToken {
    const token: Omit<QueryToken, 'raw'> = { type: 'filter', key, value, negated };

    return { ...token, raw: toCanonicalRaw(token) };
}

function matchesFilter(token: QueryToken, key: FilterKey, value?: string): boolean {
    if (token.type !== 'filter' || token.key !== key) return false;

    if (value === undefined) return true;

    return token.value.toLowerCase() === value.toLowerCase();
}

/** Append a filter token (no-op if an identical token already exists). */
export function addFilter(q: string, key: FilterKey, value: string, opts?: { negated?: boolean }): string {
    const negated = opts?.negated ?? false;
    const tokens = tokenizeQuery(q);
    const exists = tokens.some((token) => matchesFilter(token, key, value) && token.negated === negated);

    if (exists) return q;

    return serializeQuery([...tokens, buildFilterToken(key, value, negated)]);
}

/** Remove filter tokens by key (all of them) or by key + value. Token-level, never substring. */
export function removeFilter(q: string, key: FilterKey, value?: string): string {
    const tokens = tokenizeQuery(q);

    return serializeQuery(tokens.filter((token) => !matchesFilter(token, key, value)));
}

/** Replace all tokens of a key with a single new value (used for dates/sizes). */
export function replaceFilter(q: string, key: FilterKey, value: string, opts?: { negated?: boolean }): string {
    const tokens = tokenizeQuery(q).filter((token) => !matchesFilter(token, key));

    return serializeQuery([...tokens, buildFilterToken(key, value, opts?.negated ?? false)]);
}

/**
 * Replace the free-text portion, preserving known filter tokens.
 * Filter syntax typed into `text` is lifted into real filter tokens.
 */
export function setFreeText(q: string, text: string): string {
    const filters = tokenizeQuery(q).filter((token) => isKnownFilter(token));

    return serializeQuery([...tokenizeQuery(text), ...filters]);
}
