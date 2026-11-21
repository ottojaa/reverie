import { describe, expect, it } from 'vitest';
import { countAtLeast, formatImageCount, formatThreshold } from './taught-labels';

describe('countAtLeast', () => {
    const similarities = [0.99, 0.95, 0.95, 0.9, 0.82, 0.6];

    it('counts the images at or above the threshold', () => {
        expect(countAtLeast(similarities, 0.95)).toBe(3);
        expect(countAtLeast(similarities, 0.9)).toBe(4);
        expect(countAtLeast(similarities, 0.5)).toBe(6);
    });

    it('counts none above the best similarity and none for an empty list', () => {
        expect(countAtLeast(similarities, 1)).toBe(0);
        expect(countAtLeast([], 0.8)).toBe(0);
    });

    it('is not thrown off by float noise from the database on the threshold itself', () => {
        expect(countAtLeast([0.9699999, 0.5], 0.97)).toBe(1);
    });
});

describe('formatting', () => {
    it('formats a threshold to two decimals and pluralises image counts', () => {
        expect(formatThreshold(0.9)).toBe('0.90');
        expect(formatImageCount(1)).toBe('1 image');
        expect(formatImageCount(0)).toBe('0 images');
        expect(formatImageCount(12)).toBe('12 images');
    });
});
