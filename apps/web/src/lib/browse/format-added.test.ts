import { describe, expect, it } from 'vitest';
import { formatAddedDate } from './format-added';

const NOW = new Date('2026-11-23T18:30:00.000Z');

describe('formatAddedDate', () => {
    it('says Today with the time for the same day', () => {
        expect(formatAddedDate('2026-11-23T17:40:00.000Z', NOW, 'en-GB', 'UTC')).toBe('Today, 17:40');
    });

    it('says Yesterday for the day before', () => {
        expect(formatAddedDate('2026-11-22T09:05:00.000Z', NOW, 'en-GB', 'UTC')).toBe('Yesterday, 09:05');
    });

    it('gives weekday and date earlier this year', () => {
        expect(formatAddedDate('2026-11-20T12:00:00.000Z', NOW, 'en-GB', 'UTC')).toBe('Fri 20 Nov');
    });

    it('gives the year for another year', () => {
        expect(formatAddedDate('2025-11-14T12:00:00.000Z', NOW, 'en-GB', 'UTC')).toBe('14 Nov 2025');
    });

    it('reads the day in the given zone', () => {
        // 23:30 UTC on the 22nd is already the 23rd in Helsinki.
        expect(formatAddedDate('2026-11-22T23:30:00.000Z', NOW, 'en-GB', 'Europe/Helsinki')).toBe('Today, 01:30');
        expect(formatAddedDate('2026-11-22T23:30:00.000Z', NOW, 'en-GB', 'UTC')).toBe('Yesterday, 23:30');
    });
});
