/**
 * Human-readable formatting for filter chips and date ranges.
 */

const RELATIVE_DATE_LABELS: Record<string, string> = {
    'last-week': 'This week',
    'last-month': 'This month',
    'last-year': 'This year',
    today: 'Today',
    yesterday: 'Yesterday',
};

const TYPE_LABELS: Record<string, string> = {
    photo: 'Photos',
    document: 'Documents',
    receipt: 'Receipts',
    screenshot: 'Screenshots',
};

const FORMAT_LABELS: Record<string, string> = {
    pdf: 'PDF',
    jpg: 'JPEG',
    jpeg: 'JPEG',
    png: 'PNG',
    gif: 'GIF',
    webp: 'WebP',
    heic: 'HEIC',
    svg: 'SVG',
    tiff: 'TIFF',
};

const HAS_LABELS: Record<string, string> = {
    text: 'Has text',
    summary: 'Has summary',
    thumbnail: 'Has thumbnail',
};

const NEGATED_HAS_LABELS: Record<string, string> = {
    text: 'No text',
    summary: 'No summary',
    thumbnail: 'No thumbnail',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WHOLE_YEARS = /^(\d{4})(?:-(\d{4}))?$/;
const WHOLE_MONTHS = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/;
const FROM_FIRST_OF_MONTH = /^(\d{4}-\d{2})-01\.\.(\d{4}-\d{2})-(\d{2})$/;
const DAY = '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])';
const DAY_OR_DAY_RANGE = new RegExp(`^(${DAY})(?:\\.\\.(${DAY}))?$`);

interface YearMonth {
    year: number;
    month: number;
}

/** A run of whole calendar months, both ends included. */
interface MonthSpan {
    from: YearMonth;
    to: YearMonth;
}

/** A `YYYY-MM` string as numbers, or null when there is no such month. */
function toYearMonth(value: string): YearMonth | null {
    const [year = 0, month = 0] = value.split('-').map(Number);

    return month >= 1 && month <= 12 ? { year, month } : null;
}

/** The span between two `YYYY-MM` months; null when either doesn't exist or they run backwards. */
function toMonthSpan(first: string, last: string): MonthSpan | null {
    const from = toYearMonth(first);
    const to = toYearMonth(last);

    return from && to && first <= last ? { from, to } : null;
}

function daysInMonth({ year, month }: YearMonth): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The whole months a date value covers exactly, or null when it covers anything else. */
function toWholeMonths(raw: string): MonthSpan | null {
    const years = WHOLE_YEARS.exec(raw);

    if (years) return toMonthSpan(`${years[1]}-01`, `${years[2] ?? years[1]}-12`);

    const months = WHOLE_MONTHS.exec(raw);

    if (months) return toMonthSpan(months[1]!, months[2]!);

    const days = FROM_FIRST_OF_MONTH.exec(raw);

    if (!days) return null;

    const span = toMonthSpan(days[1]!, days[2]!);

    return span && Number(days[3]) === daysInMonth(span.to) ? span : null;
}

function formatMonthSpan({ from, to }: MonthSpan): string {
    if (from.month === 1 && to.month === 12) return from.year === to.year ? `${from.year}` : `${from.year}–${to.year}`;

    const first = MONTH_NAMES[from.month - 1];
    const last = `${MONTH_NAMES[to.month - 1]} ${to.year}`;

    if (from.year !== to.year) return `${first} ${from.year}–${last}`;

    return from.month === to.month ? last : `${first}–${last}`;
}

function formatDateValue(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A single day or a day range spelled out; anything unrecognised comes back as written. */
function formatDays(raw: string): string {
    const days = DAY_OR_DAY_RANGE.exec(raw);

    if (!days) return raw;

    const [, from = raw, to = from] = days;

    if (from === to) return formatDateValue(from);

    return `${formatDateValue(from)} – ${formatDateValue(to)}`;
}

/**
 * The label of a date filter value: the shortest one that is still exactly true. These rules are the
 * specification for every app that labels a date filter; the first that fits wins.
 *
 * | Value covers                       | Value, for example       | Label                         |
 * | ---------------------------------- | ------------------------ | ----------------------------- |
 * | a relative preset                  | `last-month`             | `This month`                  |
 * | one whole year                     | `2024`                   | `2024`                        |
 * |                                    | `2024-01-01..2024-12-31` | `2024`                        |
 * | several whole years                | `2022-2024`              | `2022–2024`                   |
 * | one whole calendar month           | `2026-10-01..2026-10-31` | `Oct 2026`                    |
 * | whole months within one year       | `2024-06-01..2024-08-31` | `Jun–Aug 2024`                |
 * | whole months across years          | `2025-12-01..2026-02-28` | `Dec 2025–Feb 2026`           |
 * | a single day                       | `2026-10-03..2026-10-03` | `Oct 3, 2026`                 |
 * | any other range                    | `2026-10-01..2026-10-30` | `Oct 1, 2026 – Oct 30, 2026`  |
 *
 * Relative presets: `today` → `Today`, `yesterday` → `Yesterday`, `last-week` → `This week`,
 * `last-month` → `This month`, `last-year` → `This year`.
 *
 * Besides these, a value may be written as a month range (`2024-06..2024-08`, labelled like the same
 * whole months) or a bare day (`2026-10-03`). "Whole" means from the first day of the first month to
 * the last day of the last one, so February ends on the 29th in a leap year. Month names are the
 * English three-letter ones. Dashes are en dashes, with spaces around them only between two spelled-out
 * days. A value in no known form, or a years or months range that runs backwards, is shown as written.
 */
export function formatDateRange(raw: string): string {
    if (RELATIVE_DATE_LABELS[raw]) return RELATIVE_DATE_LABELS[raw];

    const months = toWholeMonths(raw);

    return months ? formatMonthSpan(months) : formatDays(raw);
}

/**
 * Format a filter into a human-readable chip label.
 *
 * @param type - The filter type (e.g., "type", "folder", "uploaded")
 * @param value - The raw filter value (e.g., "photo", "last-week", "2026-01-01..2026-01-31")
 * @returns A human-readable label
 */
export function formatFilterChip(type: string, value: string): string {
    switch (type) {
        case 'type':
            return TYPE_LABELS[value] ?? capitalize(value);
        case 'format':
            return FORMAT_LABELS[value.toLowerCase()] ?? value.toUpperCase();
        case 'category':
            return capitalize(value.replace(/_/g, ' '));
        case 'folder':
            return value;
        case 'tag':
            return value;
        case 'entity':
        case 'company':
            return value;
        case 'location':
            return value;
        case 'uploaded':
            return `Uploaded ${formatDateRange(value).toLowerCase()}`;
        case 'date':
            return formatDateRange(value);
        case 'has':
            return HAS_LABELS[value] ?? `Has ${value}`;
        case '-has':
            return NEGATED_HAS_LABELS[value] ?? `No ${value}`;
        case 'size':
            return `Size ${value}`;
        case 'content':
            return `Text contains “${value}”`;
        case 'in':
            return `In ${value}`;
        default:
            return `${type}:${value}`;
    }
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
