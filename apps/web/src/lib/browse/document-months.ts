import type { Document } from '@reverie/shared';

export interface YearMonth {
    year: number;
    /** 1 to 12 */
    month: number;
}

export type GridRow = { type: 'header'; key: string; label: string } | { type: 'cards'; key: string; documents: Document[] };

interface GridRowOptions {
    columns: number;
    /** Put a month header before each run of documents from the same month. */
    groupByMonth: boolean;
    /** The year that month labels leave out ("November" this year, "November 2025" otherwise). */
    currentYear: number;
    /** The zone an upload time is read in; the viewer's own zone when omitted. */
    timeZone?: string | undefined;
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone: building an Intl.DateTimeFormat costs far more than formatting with it. */
function monthFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
    const key = timeZone ?? '';
    const cached = monthFormatters.get(key);

    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });
    monthFormatters.set(key, formatter);

    return formatter;
}

/**
 * The month a photo or video belongs to. The date taken is a local clock reading stored as if it were UTC,
 * so it is read as written, with no zone shift; an upload time is a real instant, read in `timeZone`.
 */
export function monthOf(doc: Pick<Document, 'taken_at' | 'created_at'>, timeZone?: string): YearMonth {
    const taken = doc.taken_at ? /^(\d{4})-(\d{2})/.exec(doc.taken_at) : null;

    if (taken) return { year: Number(taken[1]), month: Number(taken[2]) };

    const parts = monthFormatter(timeZone).formatToParts(new Date(doc.created_at));
    const part = (type: 'year' | 'month') => Number(parts.find((p) => p.type === type)?.value);

    return { year: part('year'), month: part('month') };
}

/** "November", or "November 2025" when it isn't `currentYear`. */
export function monthLabel({ year, month }: YearMonth, currentYear: number): string {
    const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

    return year === currentYear ? name : `${name} ${year}`;
}

/**
 * Lays `documents` (already in the list's order) out as rows of `columns` cards, with a header row before each run of
 * one month when `groupByMonth` is set. Months are runs of neighbours, never a lookup by month: the order the server
 * sent stays the order on screen, and a month that comes back later (an upload date reads in another zone than a date
 * taken) gets its own header instead of reordering the list. Headers carry the label only: a count would cover just
 * the rows loaded so far and grow as the list does.
 */
export function buildGridRows(documents: Document[], { columns, groupByMonth, currentYear, timeZone }: GridRowOptions): GridRow[] {
    if (!groupByMonth) return chunkRows(documents, columns, 'all');

    const rows: GridRow[] = [];
    let run: Document[] = [];
    let runMonth: YearMonth | null = null;

    const closeRun = () => {
        if (!runMonth) return;

        const key = `month:${runMonth.year}-${runMonth.month}:${rows.length}`;
        rows.push({ type: 'header', key, label: monthLabel(runMonth, currentYear) }, ...chunkRows(run, columns, key));
        run = [];
    };

    for (const doc of documents) {
        const month = monthOf(doc, timeZone);

        if (!runMonth || month.year !== runMonth.year || month.month !== runMonth.month) {
            closeRun();
            runMonth = month;
        }

        run.push(doc);
    }

    closeRun();

    return rows;
}

function chunkRows(documents: Document[], columns: number, keyPrefix: string): GridRow[] {
    const rows: GridRow[] = [];

    for (let start = 0; start < documents.length; start += columns) {
        const slice = documents.slice(start, start + columns);

        // Keyed by its first document so a row keeps its identity while later pages load.
        rows.push({ type: 'cards', key: `${keyPrefix}:cards:${slice[0]?.id}`, documents: slice });
    }

    return rows;
}
