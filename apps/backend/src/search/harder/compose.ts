/**
 * The queries "search harder" runs: the user's own, then one per rewording with the user's filters on top.
 * Rewordings are model text, so they only ever become plain words: never a filter, a marker, a quote or a negation.
 */
import { isKnownFilter, replaceFilter, serializeQuery, tokenizeQuery, toReadMarker, type QueryToken } from '@reverie/shared';
import { parseQuery } from '../query-parser';
import type { SearchPlan } from './plan';

/** One word of a rewording as a text token, or null when nothing searchable is left of it. */
function toTextToken(word: string): QueryToken | null {
    const value = word.replace(/[":]/g, '').replace(/^-+/, '');

    if (!value || value === '*') return null;

    return { type: 'text', value, negated: false, raw: value };
}

/**
 * Whether the user has already said something about the date: a `date:` filter, typed or read, or a date marker
 * left without its filter, which is them picking "Any" for the words it was read from.
 */
function hasDateChoice(tokens: readonly QueryToken[]): boolean {
    return tokens.some((token) => (isKnownFilter(token) && token.key === 'date') || toReadMarker(token)?.key === 'date');
}

function composeRewording(kept: QueryToken[], rewording: string, date: SearchPlan['date']): string {
    const words = rewording.split(/\s+/).flatMap((word) => toTextToken(word) ?? []);

    if (words.length === 0) return '';

    const q = serializeQuery([...words, ...kept]);

    return date ? replaceFilter(q, 'date', `${date.from}..${date.to}`) : q;
}

/**
 * The user's query exactly as sent comes first and never takes the model's date, so a wrong guess can't hide what
 * plain search finds. A rewording with no words left to search is dropped: it would only browse the filters.
 */
export function toSearchQueries(q: string, plan: SearchPlan): string[] {
    const tokens = tokenizeQuery(q);
    const kept = tokens.filter((token) => isKnownFilter(token) || toReadMarker(token) !== null);
    const date = hasDateChoice(tokens) ? null : plan.date;
    const rewordings = plan.rewordings.map((rewording) => composeRewording(kept, rewording, date)).filter((query) => parseQuery(query).fullText);

    return [...new Set([q, ...rewordings])];
}
