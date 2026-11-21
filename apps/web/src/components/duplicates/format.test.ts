import type { DuplicateGroup, DuplicateMember } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { countToTrash, formatFileType, formatResolution, formatSimilarity, toKeepId } from './format';

function member(id: string): DuplicateMember {
    return {
        id,
        filename: id + '.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1000,
        width: 100,
        height: 80,
        date: '2024-05-01T10:00:00.000Z',
        folder_id: null,
        folder_path: null,
        thumbnail_blurhash: null,
        thumbnail_urls: null,
    };
}

function group(ids: string[], suggested: string): DuplicateGroup {
    return { id: 'g-' + ids.join(''), members: ids.map(member), suggested_keep_id: suggested, min_similarity: 0.97 };
}

describe('duplicate formatting', () => {
    it('shows resolution, or says it is unknown', () => {
        expect(formatResolution({ width: 4032, height: 3024 })).toBe('4032 × 3024');
        expect(formatResolution({ width: null, height: null })).toBe('Unknown size');
    });

    it('names the file type from the mime type', () => {
        expect(formatFileType('image/jpeg')).toBe('JPEG');
        expect(formatFileType('image/svg+xml')).toBe('SVG');
    });

    it('rounds similarity down so 0.999 never reads as 100%', () => {
        expect(formatSimilarity(0.999)).toBe('99% alike');
        expect(formatSimilarity(0.953)).toBe('95% alike');
        expect(formatSimilarity(1)).toBe('Identical files');
    });

    it('keeps the picked copy while it is a member, else the suggested one', () => {
        const g = group(['a', 'b', 'c'], 'a');

        expect(toKeepId(g, 'c')).toBe('c');
        expect(toKeepId(g, 'gone')).toBe('a');
        expect(toKeepId(g, undefined)).toBe('a');
    });

    it('counts every copy but one per group', () => {
        expect(countToTrash([group(['a', 'b'], 'a'), group(['c', 'd', 'e'], 'c')])).toBe(3);
        expect(countToTrash([])).toBe(0);
    });
});
