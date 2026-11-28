/**
 * Filters read from a typed sentence. The server adds an ordinary filter token and a marker saying which
 * words it came from (`type:receipt read:"type:receipt kuitit"`). The words stay in the query as free
 * text; the marker is what keeps them out of the searched text, and what lets a client tell the filter
 * apart from a picked one. `apps/android/.../domain/search/ReadMarkers.kt` is the same for Android.
 */
import type { FilterKey, QueryToken } from './query-tokens.js';

/** The only filters read from words. */
export type ReadKey = Extract<FilterKey, 'type' | 'date'>;

export interface ReadMarker {
    key: ReadKey;
    /** The filter value read from the words. */
    value: string;
    words: string[];
}

const MARKER_VALUE = /^(type|date):(\S+)\s+(\S.*)$/s;

/** The marker a token holds; null for every other token, a `read:` of another shape included (that is plain text). */
export function toReadMarker(token: QueryToken): ReadMarker | null {
    if (token.type !== 'filter' || token.key !== 'read' || token.negated) return null;

    const [, key, value, words] = MARKER_VALUE.exec(token.value) ?? [];

    if (!key || !value || !words) return null;

    return { key: key as ReadKey, value, words: words.trim().split(/\s+/) };
}

/** The marker token for a filter read from `words`, none of which may contain a double quote. */
export function buildReadMarker(key: ReadKey, value: string, words: readonly string[]): QueryToken {
    const body = `${key}:${value} ${words.join(' ')}`;

    return { type: 'filter', key: 'read', value: body, negated: false, raw: `read:"${body}"` };
}

/** A word typed as it is, neither quoted, negated nor a filter: the only kind a filter is read from. */
export function isPlainWord(token: QueryToken): boolean {
    return token.type === 'text' && !token.negated;
}

/**
 * The tokens of the first place `words` appear in a row as plain words, ignoring case; filters between
 * them don't break the row. Null when the words aren't there.
 */
export function findWordRun(tokens: readonly QueryToken[], words: readonly string[]): QueryToken[] | null {
    const text = tokens.filter((token) => token.type !== 'filter');

    for (let start = 0; start + words.length <= text.length; start++) {
        const run = text.slice(start, start + words.length);

        if (run.every((token, i) => isPlainWord(token) && token.value.toLowerCase() === words[i]?.toLowerCase())) return run;
    }

    return null;
}

/** Whether `token` is the filter the marker added, still holding the value it read. */
function isReadFilter(token: QueryToken, marker: ReadMarker): boolean {
    return token.type === 'filter' && !token.negated && token.key === marker.key && token.value.toLowerCase() === marker.value.toLowerCase();
}

/** The keys whose one filter still holds the value read from the user's words. */
export function getReadKeys(tokens: readonly QueryToken[]): Set<FilterKey> {
    const markers = tokens.map(toReadMarker).filter((marker) => marker !== null);

    const isStillRead = (marker: ReadMarker) => {
        const [first, ...others] = tokens.filter((token) => token.type === 'filter' && token.key === marker.key);

        return first !== undefined && others.length === 0 && isReadFilter(first, marker);
    };

    return new Set(markers.filter(isStillRead).map((marker) => marker.key));
}

/**
 * The tokens search runs on. Markers go, and so do the words of each marker whose key has a filter,
 * whatever its value now. With no filter of that key left the marker is orphaned: its words are searched.
 */
export function toSearchedTokens(tokens: readonly QueryToken[]): QueryToken[] {
    const unmarked = tokens.filter((token) => !toReadMarker(token));
    const filteredKeys = new Set(unmarked.filter((token) => token.type === 'filter').map((token) => token.key));
    const markers = tokens.map(toReadMarker).filter((marker) => marker !== null);
    const applying = markers.filter((marker) => filteredKeys.has(marker.key));

    return applying.reduce((searched, marker) => {
        const run = findWordRun(searched, marker.words);

        return run ? searched.filter((token) => !run.includes(token)) : searched;
    }, unmarked);
}

/**
 * `tokens` without the markers whose words are no longer in `text`, and without the filters still holding
 * what those words said. A filter whose value was changed since stays.
 */
export function dropDeletedReads(tokens: readonly QueryToken[], text: readonly QueryToken[]): QueryToken[] {
    const deleted = tokens.flatMap((token) => {
        const marker = toReadMarker(token);

        return marker && !findWordRun(text, marker.words) ? [{ token, marker }] : [];
    });

    return tokens.filter((token) => !deleted.some((gone) => token === gone.token || isReadFilter(token, gone.marker)));
}
