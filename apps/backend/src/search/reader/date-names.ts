import { type CalendarDay, lastSeasonYear, monthValue, type Season, seasonValue, thisSeasonYear } from './date-ranges';

/** A month or a season named by a word. */
export interface NamedPeriod {
    inYear(year: number): string;
    /** "this June" (offset 0) or "last summer" (offset -1). */
    relative(today: CalendarDay, offset: number): string;
    /** The most recent one that has begun; null where the word alone names no date. */
    alone(today: CalendarDay): string | null;
    /** Also an ordinary English word ("may", "march"), so alone it needs "in" or "from" before it. */
    isAmbiguous: boolean;
}

const ENGLISH_MONTHS = 'january february march april may june july august september october november december'.split(' ');

const FINNISH_MONTH_STEMS = 'tammi helmi maalis huhti touko kesä heinä elo syys loka marras joulu'.split(' ');

const FINNISH_MONTH_ENDINGS = ['kuu', 'kuun', 'kuuta', 'kuussa', 'kuusta', 'kuulta'];

const SEASON_FORMS: Record<Season, string> = {
    spring: 'spring kevät kevään keväällä keväältä keväänä',
    summer: 'summer kesä kesän kesällä kesältä kesänä',
    autumn: 'autumn fall syksy syksyn syksyllä syksyltä syksynä',
    winter: 'winter talvi talven talvella talvelta talvena',
};

function toMonthPeriod(month: number, isAmbiguous: boolean): NamedPeriod {
    const mostRecent = (today: CalendarDay, latest: number) => monthValue(month <= latest ? today.year : today.year - 1, month);

    return {
        inYear: (year) => monthValue(year, month),
        relative: (today, offset) => (offset === 0 ? monthValue(today.year, month) : mostRecent(today, today.month - 1)),
        alone: (today) => mostRecent(today, today.month),
        isAmbiguous,
    };
}

function toSeasonPeriod(season: Season): NamedPeriod {
    const toYear = (today: CalendarDay, offset: number) => (offset === 0 ? thisSeasonYear(today, season) : lastSeasonYear(today, season));

    return {
        inYear: (year) => seasonValue(year, season),
        relative: (today, offset) => seasonValue(toYear(today, offset), season),
        alone: () => null,
        isAmbiguous: false,
    };
}

const PERIODS: ReadonlyMap<string, NamedPeriod> = new Map([
    ...ENGLISH_MONTHS.map((name, i) => [name, toMonthPeriod(i + 1, name === 'may' || name === 'march')] as const),
    ...FINNISH_MONTH_STEMS.flatMap((stem, i) => FINNISH_MONTH_ENDINGS.map((end) => [stem + end, toMonthPeriod(i + 1, false)] as const)),
    ...Object.entries(SEASON_FORMS).flatMap(([season, forms]) => forms.split(' ').map((form) => [form, toSeasonPeriod(season as Season)] as const)),
]);

export function toNamedPeriod(word: string): NamedPeriod | null {
    return PERIODS.get(word) ?? null;
}
