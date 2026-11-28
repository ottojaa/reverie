/**
 * Reads a file type and a date out of a typed sentence, in English or Finnish. Local rules only: no
 * database, no outside service. When unsure, nothing is read and the words are searched as typed.
 */
import {
    buildFilterToken,
    buildReadMarker,
    findMarkedWords,
    isPlainWord,
    type QueryToken,
    type ReadKey,
    serializeQuery,
    tokenizeQuery,
    toReadMarker,
} from '@reverie/shared';
import { type CalendarDay, toCalendarDay } from './date-ranges';
import { matchDatePhrase } from './date-words';
import { toTypeValue } from './type-words';

/** Something the words say, and the words saying it. A null value is a date that can't be read for sure. */
interface Candidate {
    key: ReadKey;
    value: string | null;
    words: QueryToken[];
}

const DATE_GLUE = new Set(['from', 'in', 'during']);

function toWord(token: QueryToken | undefined): string {
    return token?.value.toLowerCase() ?? '';
}

/** A quote left open would swallow anything appended to the query. */
function hasOpenQuote(q: string): boolean {
    return tokenizeQuery(q + ' x').at(-1)?.raw !== 'x';
}

/** The runs of words that may be read: quoted, negated, filter and already read tokens end a run. */
function toReadableRuns(tokens: readonly QueryToken[]): QueryToken[][] {
    // Words a marker names have been read already, whether or not its filter is still there
    const markers = tokens.map(toReadMarker).filter((marker) => marker !== null);
    const claimed = findMarkedWords(tokens, markers);
    const isReadable = (token: QueryToken) => isPlainWord(token) && !claimed.has(token);
    const starts = tokens.flatMap((token, i) => (isReadable(token) && !(i > 0 && isReadable(tokens[i - 1] as QueryToken)) ? [i] : []));

    return starts.map((start) => {
        const end = tokens.findIndex((token, i) => i > start && !isReadable(token));

        return tokens.slice(start, end === -1 ? tokens.length : end);
    });
}

/** Type words, each with the "of" after it when the sentence goes on past that. */
function findTypes(run: readonly QueryToken[], tokens: readonly QueryToken[]): Candidate[] {
    return run.flatMap((token, i) => {
        const value = toTypeValue(toWord(token));
        const next = run[i + 1];

        if (!value) return [];

        const isGlued = next && toWord(next) === 'of' && tokens.slice(tokens.indexOf(next) + 1).some((later) => later.type !== 'filter');

        return [{ key: 'type', value, words: isGlued ? [token, next] : [token] } satisfies Candidate];
    });
}

/** Date phrases from left to right, each with the "from" or "in" before it. */
function findDates(run: readonly QueryToken[], today: CalendarDay): Candidate[] {
    const words = run.map(toWord);
    const found: Candidate[] = [];

    for (let at = 0; at < words.length; ) {
        const phrase = matchDatePhrase(words, at, today);

        if (!phrase) {
            at++;
            continue;
        }

        const from = DATE_GLUE.has(words[at - 1] ?? '') ? at - 1 : at;

        found.push({ key: 'date', value: phrase.value, words: run.slice(from, at + phrase.length) });
        at += phrase.length;
    }

    return found;
}

/** The one candidate for a key, unless the key already has a filter or the words say more than one thing. */
function toRead(candidates: Candidate[], tokens: readonly QueryToken[]) {
    const [only, ...others] = candidates;

    if (!only?.value || others.length > 0) return [];

    if (tokens.some((token) => token.type === 'filter' && token.key === only.key)) return [];

    return [{ ...only, value: only.value }];
}

/**
 * `q` with, for each thing read from its words, the filter and a marker naming the words (see
 * read-markers in `@reverie/shared`). `today` is the user's local date. Unchanged when nothing is read.
 */
export function readQuery(q: string, today: string): string {
    if (hasOpenQuote(q)) return q;

    const tokens = tokenizeQuery(q);
    const runs = toReadableRuns(tokens);
    const day = toCalendarDay(today);
    const types = runs.flatMap((run) => findTypes(run, tokens));
    const dates = runs.flatMap((run) => findDates(run, day));
    const reads = [...toRead(types, tokens), ...toRead(dates, tokens)];

    if (reads.length === 0) return q;

    const filters = reads.map(({ key, value }) => buildFilterToken(key, value));
    const markers = reads.map(({ key, value, words }) =>
        buildReadMarker(
            key,
            value,
            words.map((word) => word.value),
        ),
    );

    return serializeQuery([...tokens, ...filters, ...markers]);
}
