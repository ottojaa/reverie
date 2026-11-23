const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale, zone and shape: building an Intl.DateTimeFormat costs far more than formatting with it (a table formats a date per row). */
function formatterFor(locale: string | undefined, timeZone: string | undefined, shape: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${timeZone ?? ''}|${shape}`;
    const cached = formatters.get(key);

    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, formatter);

    return formatter;
}

/** The calendar day of `date` in `timeZone`, as a day count (only differences matter), and its year. */
function dayOf(date: Date, timeZone: string | undefined): { day: number; year: number } {
    const parts = formatterFor('en-US', timeZone, 'day', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);

    return { day: Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000), year: part('year') };
}

/**
 * When a document was added, for a table cell: "Today, 18:12", "Yesterday, 17:40", "Fri 20 Nov" this year,
 * "20 Nov 2025" before. `now`, `locale` and `timeZone` default to the viewer's own.
 */
export function formatAddedDate(iso: string, now: Date = new Date(), locale?: string, timeZone?: string): string {
    const added = new Date(iso);
    const today = dayOf(now, timeZone);
    const addedDay = dayOf(added, timeZone);
    const ago = today.day - addedDay.day;
    const time = () => formatterFor(locale, timeZone, 'time', { hour: '2-digit', minute: '2-digit' }).format(added);

    if (ago === 0) return `Today, ${time()}`;

    if (ago === 1) return `Yesterday, ${time()}`;

    if (addedDay.year === today.year) return formatterFor(locale, timeZone, 'this-year', { weekday: 'short', day: 'numeric', month: 'short' }).format(added);

    return formatterFor(locale, timeZone, 'other-year', { day: 'numeric', month: 'short', year: 'numeric' }).format(added);
}
