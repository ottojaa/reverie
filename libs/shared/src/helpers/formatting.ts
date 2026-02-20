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

function formatDateValue(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a raw date range string (e.g. "2026-02-12..2026-02-12") into a readable label.
 */
export function formatDateRange(raw: string): string {
    if (RELATIVE_DATE_LABELS[raw]) return RELATIVE_DATE_LABELS[raw];

    if (/^\d{4}$/.test(raw)) return raw;

    if (raw.includes('..')) {
        const [from, to] = raw.split('..');

        if (!from || !to) return raw;

        if (from === to) return formatDateValue(from);

        return `${formatDateValue(from)} – ${formatDateValue(to)}`;
    }

    return raw;
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
        case 'in':
            return `In ${value}`;
        default:
            return `${type}:${value}`;
    }
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
