import { describe, expect, it } from 'vitest';
import { emptyTabMessage, kindOfTab, parseBrowseTab, tabSubtitle } from './browse-tabs';

describe('parseBrowseTab', () => {
    it('reads each stored tab', () => {
        expect(parseBrowseTab('"all"')).toBe('all');
        expect(parseBrowseTab('"image"')).toBe('image');
        expect(parseBrowseTab('"video"')).toBe('video');
        expect(parseBrowseTab('"file"')).toBe('file');
    });

    it('opens All for anything that is not a tab', () => {
        expect(parseBrowseTab('"photos"')).toBe('all');
        expect(parseBrowseTab('42')).toBe('all');
        expect(parseBrowseTab('null')).toBe('all');
        expect(parseBrowseTab('image')).toBe('all');
        expect(parseBrowseTab('')).toBe('all');
    });
});

describe('kindOfTab', () => {
    it('asks the server for no kind on All, and for the tab own kind otherwise', () => {
        expect(kindOfTab('all')).toBeUndefined();
        expect(kindOfTab('image')).toBe('image');
        expect(kindOfTab('video')).toBe('video');
        expect(kindOfTab('file')).toBe('file');
    });
});

describe('tabSubtitle', () => {
    it('names what the tab lists, with its total', () => {
        expect(tabSubtitle('image', 168)).toBe('168 photos');
        expect(tabSubtitle('video', 24)).toBe('24 videos');
        expect(tabSubtitle('file', 58)).toBe('58 files');
        expect(tabSubtitle('all', 250)).toBe('250 files');
    });

    it('uses the singular for one', () => {
        expect(tabSubtitle('image', 1)).toBe('1 photo');
        expect(tabSubtitle('video', 1)).toBe('1 video');
        expect(tabSubtitle('file', 1)).toBe('1 file');
    });
});

describe('emptyTabMessage', () => {
    it('says where there is nothing of the kind', () => {
        expect(emptyTabMessage('video', false)).toBe('No videos yet');
        expect(emptyTabMessage('image', true)).toBe('No photos in this folder yet');
    });
});
