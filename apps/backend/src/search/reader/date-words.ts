/**
 * Date phrases in lowercase English and Finnish words. A phrase that is clearly about time but can't be
 * read for sure ("5 June", "since 2020") is still reported, with no value, so that no part of it, and no
 * other date beside it, gets read instead.
 */
import { type NamedPeriod, toNamedPeriod, toUnambiguousPeriod } from './date-names';
import { type CalendarDay, dayValue, monthValue, weekValue } from './date-ranges';

export interface DatePhrase {
    /** How many words the phrase takes. */
    length: number;
    /** The `date:` value; null when unsure. */
    value: string | null;
}

const EARLIEST_YEAR = 1950;

function toWordMap<T>(entries: [string, T][]): ReadonlyMap<string, T> {
    return new Map(entries.flatMap(([words, value]) => words.split(' ').map((word) => [word, value] as const)));
}

function toWordSet(words: string): ReadonlySet<string> {
    return new Set(words.split(' '));
}

const DAY_OFFSETS = toWordMap([
    ['today tänään', 0],
    ['yesterday eilen eilisen eiliset eiliseltä', -1],
]);

/** "this" and "last". */
const OFFSETS = toWordMap([
    ['this tämä tämän tällä tältä tässä tänä', 0],
    ['last viime', -1],
]);

type Unit = 'week' | 'month' | 'year';

const UNITS = toWordMap<Unit>([
    ['week viikko viikon viikolla viikolta viikkona', 'week'],
    ['month kuu kuun kuussa kuulta kuukausi kuukauden kuukaudessa kuukaudelta kuukautena', 'month'],
    ['year vuosi vuoden vuonna vuodelta', 'year'],
]);

const UNIT_VALUES: Record<Unit, (today: CalendarDay, offset: number) => string> = {
    week: weekValue,
    month: (today, offset) => monthValue(today.year, today.month + offset),
    year: (today, offset) => String(today.year + offset),
};

/** Words that say the number after them is a year. */
const YEAR_MARKERS = toWordSet('vuosi vuonna vuoden vuodelta vuodesta vuotta');

/** Words that may stand between a month or season and its year. */
const YEAR_LINKS = toWordSet('of vuonna vuoden');

/** Words after which a four-digit number is a name or a number rather than a year. */
const NOT_YEAR_AFTER = toWordSet(
    'windows office server model malli version versio v no nr nro number numero page sivu room huone zip postinumero pin code koodi id € $ £',
);

/** Units and currencies: a number before one is an amount. */
const NOT_YEAR_BEFORE = toWordSet(
    'e eur euro euros euroa € usd dollar dollars $ £ gbp pounds kr sek mk markkaa km m cm mm kg g mg l ml w kw kwh hz mah mb gb kb px rpm pages sivua kpl pcs',
);

/** A range with an open end, which a `date:` filter value read from words never is. */
const OPEN_BEFORE = toWordSet('since before after until till ennen alkaen');

const OPEN_AFTER = toWordSet('lähtien alkaen asti saakka jälkeen onwards');

const MONTH_GLUE = toWordSet('in from during');

const NUMBER = /^\d+(\.|,|st|nd|rd|th)?$/;

interface Words {
    words: readonly string[];
    at: number;
    today: CalendarDay;
}

function toYear(word: string | undefined, today: CalendarDay): number | null {
    if (!word || !/^\d{4}$/.test(word)) return null;

    const year = Number(word);

    return year >= EARLIEST_YEAR && year <= today.year ? year : null;
}

/** "today", "eilen". */
function matchDay({ words, at, today }: Words): DatePhrase | null {
    const offset = DAY_OFFSETS.get(words[at] ?? '');

    return offset === undefined ? null : { length: 1, value: dayValue(today, offset) };
}

/** "last week", "this summer", "viime kesäkuussa", "viime vuoden kesältä". */
function matchRelative({ words, at, today }: Words): DatePhrase | null {
    const offset = OFFSETS.get(words[at] ?? '');
    const next = words[at + 1] ?? '';

    if (offset === undefined) return null;

    const unit = UNITS.get(next);
    const periodOfYear = unit === 'year' ? toUnambiguousPeriod(words[at + 2] ?? '') : null;

    if (periodOfYear) return { length: 3, value: periodOfYear.inYear(today.year + offset) };

    if (unit) return { length: 2, value: UNIT_VALUES[unit](today, offset) };

    // "last May" is a month; "this may be it" is not
    const period = offset === 0 ? toUnambiguousPeriod(next) : toNamedPeriod(next);

    return period && { length: 2, value: period.relative(today, offset) };
}

/** "June 2024", "summer of 2024", "kesällä viime vuonna". */
function matchPeriodThenYear({ words, at, today }: Words, period: NamedPeriod): DatePhrase | null {
    const yearAt = YEAR_LINKS.has(words[at + 1] ?? '') ? at + 2 : at + 1;
    const year = toYear(words[yearAt], today);

    if (year !== null) return { length: yearAt - at + 1, value: period.inYear(year) };

    const offset = OFFSETS.get(words[yearAt] ?? '');

    if (offset === undefined || UNITS.get(words[yearAt + 1] ?? '') !== 'year') return null;

    return { length: yearAt - at + 2, value: period.inYear(today.year + offset) };
}

/** A month or season, with its year or alone. A number beside a month may be a day, which isn't read. */
function matchPeriod(input: Words): DatePhrase | null {
    const { words, at, today } = input;
    const period = toNamedPeriod(words[at] ?? '');

    if (!period) return null;

    const isAfterNumber = NUMBER.test(words[at - 1] ?? '');
    const withYear = matchPeriodThenYear(input, period);

    if (withYear) return isAfterNumber ? { ...withYear, value: null } : withYear;

    const value = period.alone(today);

    if (value === null || (period.isAmbiguous && !MONTH_GLUE.has(words[at - 1] ?? ''))) return null;

    return { length: 1, value: isAfterNumber || NUMBER.test(words[at + 1] ?? '') ? null : value };
}

/** "2024", "vuonna 2024", "vuoden 2024 kesällä". */
function matchYear({ words, at, today }: Words): DatePhrase | null {
    const isMarked = YEAR_MARKERS.has(words[at] ?? '');
    const yearAt = isMarked ? at + 1 : at;
    const year = toYear(words[yearAt], today);

    if (year === null) return null;

    const period = toUnambiguousPeriod(words[yearAt + 1] ?? '');

    if (period) return { length: yearAt - at + 2, value: period.inYear(year) };

    if (isMarked) return { length: 2, value: String(year) };

    if (NOT_YEAR_AFTER.has(words[at - 1] ?? '') || NOT_YEAR_BEFORE.has(words[at + 1] ?? '')) return null;

    return { length: 1, value: String(year) };
}

function isOpenEnded(words: readonly string[], at: number, length: number): boolean {
    const before = words[at - 1] === 'the' ? words[at - 2] : words[at - 1];

    return OPEN_BEFORE.has(before ?? '') || OPEN_AFTER.has(words[at + length] ?? '');
}

/** The longest date phrase starting at `words[at]`, or null when none starts there. */
export function matchDatePhrase(words: readonly string[], at: number, today: CalendarDay): DatePhrase | null {
    const input = { words, at, today };
    const matches = [matchDay, matchRelative, matchPeriod, matchYear].map((match) => match(input)).filter((match) => match !== null);
    const [longest] = matches.sort((a, b) => b.length - a.length);

    if (!longest) return null;

    return isOpenEnded(words, at, longest.length) ? { ...longest, value: null } : longest;
}
