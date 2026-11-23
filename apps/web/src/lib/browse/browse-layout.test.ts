import { describe, expect, it } from 'vitest';
import { hasLayoutChoice, parseBrowseLayout } from './browse-layout';

describe('parseBrowseLayout', () => {
    it('reads each stored layout', () => {
        expect(parseBrowseLayout('"cards"')).toBe('cards');
        expect(parseBrowseLayout('"grid"')).toBe('grid');
        expect(parseBrowseLayout('"justified"')).toBe('justified');
    });

    it('falls back to Cards for anything else', () => {
        expect(parseBrowseLayout('"mosaic"')).toBe('cards');
        expect(parseBrowseLayout('42')).toBe('cards');
        expect(parseBrowseLayout('null')).toBe('cards');
        expect(parseBrowseLayout('not json')).toBe('cards');
        expect(parseBrowseLayout('')).toBe('cards');
    });
});

describe('hasLayoutChoice', () => {
    it('is offered on Photos and Videos only', () => {
        expect(['all', 'image', 'video', 'file'].map((tab) => hasLayoutChoice(tab as 'all'))).toEqual([false, true, true, false]);
    });
});
