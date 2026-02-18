/**
 * Format a Date to YYYY-MM-DD using local date parts.
 * Use this for date-only columns (e.g. extracted_date) when serializing to API responses.
 * Avoids toISOString() which converts to UTC and can shift the calendar date in positive-offset timezones.
 */
export function formatDateOnly(d: Date | null | undefined): string | null {
    if (!d) return null;

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
}
