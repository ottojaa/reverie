import { describe, expect, it } from 'vitest';
import { emptyKindMessage, kindSubtitle, kindTitle, parseBrowseSearch } from './browse-kinds';

describe('parseBrowseSearch', () => {
    it('keeps each kind', () => {
        expect(parseBrowseSearch({ kind: 'image' })).toEqual({ kind: 'image' });
        expect(parseBrowseSearch({ kind: 'video' })).toEqual({ kind: 'video' });
        expect(parseBrowseSearch({ kind: 'file' })).toEqual({ kind: 'file' });
    });

    it('opens the dashboard for no kind or one that is not a kind', () => {
        expect(parseBrowseSearch({})).toEqual({});
        expect(parseBrowseSearch({ kind: 'photos' })).toEqual({});
        // Present and undefined, not left out: the router merges the raw search of the parent under a validated one.
        expect(parseBrowseSearch({ kind: 'photos' })).toHaveProperty('kind', undefined);
        expect(parseBrowseSearch({ kind: ['image'] })).toEqual({});
        expect(parseBrowseSearch({ kind: 3 })).toEqual({});
        expect(parseBrowseSearch({ kind: '' })).toEqual({});
    });

    it('drops everything but the kind', () => {
        expect(parseBrowseSearch({ kind: 'file', q: 'x' })).toEqual({ kind: 'file' });
    });
});

describe('kindTitle', () => {
    it('names the kind the way the dashboard cards do', () => {
        expect(['image', 'video', 'file'].map((kind) => kindTitle(kind as 'image'))).toEqual(['Photos', 'Videos', 'Files']);
    });
});

describe('kindSubtitle', () => {
    it('names what the view lists, with its total and where it is counted', () => {
        expect(kindSubtitle('image', 38, 'My Files')).toBe('38 photos · My Files');
        expect(kindSubtitle('video', 24, 'Holidays')).toBe('24 videos · Holidays');
        expect(kindSubtitle('file', 58, 'My Files')).toBe('58 files · My Files');
    });

    it('uses the singular for one', () => {
        expect(kindSubtitle('image', 1, 'My Files')).toBe('1 photo · My Files');
        expect(kindSubtitle('video', 1, 'My Files')).toBe('1 video · My Files');
        expect(kindSubtitle('file', 1, 'My Files')).toBe('1 file · My Files');
    });
});

describe('emptyKindMessage', () => {
    it('says where there is nothing of the kind', () => {
        expect(emptyKindMessage('video', false)).toBe('No videos yet');
        expect(emptyKindMessage('image', true)).toBe('No photos in this folder yet');
    });
});
