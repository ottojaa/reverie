import type { Document } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { buildGridRows, monthLabel, monthOf, type GridRow } from './document-months';

function doc(id: string, taken_at: string | null, created_at = '2026-11-23T10:00:00.000Z'): Document {
    return { id, taken_at, created_at } as Document;
}

function shape(rows: GridRow[]): string[] {
    return rows.map((row) => (row.type === 'header' ? `# ${row.label}` : row.documents.map((d) => d.id).join(',')));
}

describe('monthOf', () => {
    it('reads the date taken as written, with no zone shift', () => {
        // 23:30 on the last evening of November where it was taken; any zone east of UTC would push it into December.
        expect(monthOf(doc('a', '2026-11-30T23:30:00.000Z'), 'Pacific/Auckland')).toEqual({ year: 2026, month: 11 });
        expect(monthOf(doc('a', '2026-12-01T00:30:00.000Z'), 'America/Los_Angeles')).toEqual({ year: 2026, month: 12 });
    });

    it('falls back to the upload time, read in the given zone', () => {
        const uploaded = '2026-11-30T23:30:00.000Z';

        expect(monthOf(doc('a', null, uploaded), 'UTC')).toEqual({ year: 2026, month: 11 });
        expect(monthOf(doc('a', null, uploaded), 'Europe/Helsinki')).toEqual({ year: 2026, month: 12 });
        expect(monthOf(doc('a', null, uploaded), 'America/Los_Angeles')).toEqual({ year: 2026, month: 11 });
    });

    it('prefers the date taken over the upload time', () => {
        expect(monthOf(doc('a', '2025-07-04T12:00:00.000Z', '2026-11-23T10:00:00.000Z'), 'UTC')).toEqual({ year: 2025, month: 7 });
    });
});

describe('monthLabel', () => {
    it('leaves the year out for the current year', () => {
        expect(monthLabel({ year: 2026, month: 11 }, 2026)).toBe('November');
    });

    it('adds the year for any other year', () => {
        expect(monthLabel({ year: 2025, month: 11 }, 2026)).toBe('November 2025');
        expect(monthLabel({ year: 2027, month: 1 }, 2026)).toBe('January 2027');
    });
});

describe('buildGridRows', () => {
    const options = { columns: 2, currentYear: 2026, timeZone: 'UTC' };

    it('puts one label-only header before each month and starts a new row at it', () => {
        const rows = buildGridRows(
            [
                doc('1', '2026-11-20T10:00:00.000Z'),
                doc('2', '2026-11-02T10:00:00.000Z'),
                doc('3', '2026-11-01T10:00:00.000Z'),
                doc('4', '2025-12-31T23:59:00.000Z'),
            ],
            options,
        );

        expect(shape(rows)).toEqual(['# November', '1,2', '3', '# December 2025', '4']);
        expect(rows.filter((row) => row.type === 'header').every((row) => !/\d$/.test(row.label) || /\d{4}$/.test(row.label))).toBe(true);
    });

    it('groups an upload-date fallback with its own month', () => {
        const rows = buildGridRows([doc('1', null, '2026-11-23T10:00:00.000Z'), doc('2', '2026-10-05T08:00:00.000Z')], options);

        expect(shape(rows)).toEqual(['# November', '1', '# October', '2']);
    });

    it('keeps the order it was given: a month that returns gets a second header with its own key', () => {
        const rows = buildGridRows([doc('1', '2026-11-20T10:00:00.000Z'), doc('2', '2026-10-05T08:00:00.000Z'), doc('3', '2026-11-01T10:00:00.000Z')], options);

        expect(shape(rows)).toEqual(['# November', '1', '# October', '2', '# November', '3']);
        expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    });

    it('keeps row keys while a later page extends the last month', () => {
        const first = [doc('1', '2026-11-20T10:00:00.000Z'), doc('2', '2026-11-19T10:00:00.000Z')];
        const before = buildGridRows(first, options);
        const after = buildGridRows([...first, doc('3', '2026-11-18T10:00:00.000Z'), doc('4', '2026-10-30T10:00:00.000Z')], options);

        expect(after.slice(0, before.length).map((row) => row.key)).toEqual(before.map((row) => row.key));
    });

    it('returns nothing for no documents', () => {
        expect(buildGridRows([], options)).toEqual([]);
    });
});
