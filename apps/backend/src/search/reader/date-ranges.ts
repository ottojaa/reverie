/**
 * Calendar arithmetic for read dates, in the two forms a `date:` filter is written in: `YYYY` and
 * `YYYY-MM-DD..YYYY-MM-DD`. Days are UTC midnights, so the server's own timezone never moves one.
 * Months count from 1; a month or day outside its range rolls into the neighbouring one.
 */

export interface CalendarDay {
    year: number;
    month: number;
    day: number;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** The first month of each season; each lasts three months, so winter runs across the year end. */
const SEASON_START: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };

export function toCalendarDay(isoDay: string): CalendarDay {
    const [year = 0, month = 0, day = 0] = isoDay.split('-').map(Number);

    return { year, month, day };
}

function toIsoDay(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function toRange(from: string, to: string): string {
    return `${from}..${to}`;
}

/** One day, `offset` days from `today`. */
export function dayValue(today: CalendarDay, offset: number): string {
    const day = toIsoDay(today.year, today.month, today.day + offset);

    return toRange(day, day);
}

/** The Monday-to-Sunday week `offset` weeks from the one `today` is in. */
export function weekValue(today: CalendarDay, offset: number): string {
    const sinceMonday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
    const monday = today.day - sinceMonday + offset * 7;

    return toRange(toIsoDay(today.year, today.month, monday), toIsoDay(today.year, today.month, monday + 6));
}

export function monthValue(year: number, month: number): string {
    return toRange(toIsoDay(year, month, 1), toIsoDay(year, month + 1, 0));
}

/** The season starting in `year`: winter 2024 is December 2024 to February 2025. */
export function seasonValue(year: number, season: Season): string {
    const start = SEASON_START[season];

    return toRange(toIsoDay(year, start, 1), toIsoDay(year, start + 3, 0));
}

/** The year of the season "this summer" means. In January and February "this winter" began the year before. */
export function thisSeasonYear(today: CalendarDay, season: Season): number {
    return season === 'winter' && today.month < 3 ? today.year - 1 : today.year;
}

/** The year of the most recent such season that has ended. */
export function lastSeasonYear(today: CalendarDay, season: Season): number {
    const current = thisSeasonYear(today, season);
    const end = seasonValue(current, season).slice(-10);

    return end < toIsoDay(today.year, today.month, today.day) ? current : current - 1;
}
