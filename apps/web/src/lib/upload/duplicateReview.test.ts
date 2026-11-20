import type { CheckContentResult } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { describeContent, describeNameConflict, needsConflictChoice, toBreadcrumb, toKeptIds, toReviewItems } from './duplicateReview';
import type { UploadFile } from './types';

const upload = (id: string, name: string): UploadFile => ({ id, file: new File(['x'], name), status: 'queued', uploadProgress: 0, processingProgress: 0 });
const result = (name: string, over: Partial<CheckContentResult> = {}): CheckContentResult => ({
    name,
    sha256: null,
    content: null,
    name_conflict: false,
    ...over,
});

describe('toReviewItems', () => {
    it('keeps only the files the check flagged, paired by position', () => {
        const queued = [upload('a', 'a.jpg'), upload('b', 'b.jpg'), upload('c', 'c.jpg'), upload('d', 'd.jpg')];
        const results = [
            result('a.jpg'),
            result('b.jpg', { content: { where: 'trash' } }),
            result('c.jpg', { name_conflict: true }),
            result('d.jpg', { content: { where: 'private' }, name_conflict: true }),
        ];

        expect(toReviewItems(queued, results).map((i) => i.fileId)).toEqual(['b', 'c', 'd']);
    });
});

describe('describeContent', () => {
    it('names the folder with a breadcrumb and the filename when it differs', () => {
        expect(describeContent({ where: 'folder', folder_path: ['Work', 'Invoices'], filename: 'old.pdf' }, 'new.pdf')).toEqual({
            label: 'Already in Work › Invoices',
            detail: 'As old.pdf',
        });
    });

    it('does not repeat an identical filename', () => {
        expect(describeContent({ where: 'folder', folder_path: ['Work'], filename: 'a.pdf' }, 'a.pdf').detail).toBeUndefined();
    });

    it('says so when the file sits outside any folder', () => {
        expect(describeContent({ where: 'folder', folder_path: null, filename: 'a.pdf' }, 'a.pdf').label).toBe('Already in your library, not in a folder');
    });

    it('says only "private folder" and "Trash" for those, with nothing else', () => {
        expect(describeContent({ where: 'private' }, 'a.pdf')).toEqual({ label: 'Already in a private folder' });
        expect(describeContent({ where: 'trash' }, 'a.pdf')).toEqual({ label: 'Already in Trash' });
    });
});

describe('name conflict wording and choice', () => {
    it('words the conflict for both cases', () => {
        expect(describeNameConflict('Invoices', false)).toBe('A different file with this name is already in Invoices');
        expect(describeNameConflict('Invoices', true)).toBe('Same name also exists in Invoices');
    });

    it('asks replace / keep both for a name-only conflict, and for a content match only when it is uploaded anyway', () => {
        const [nameOnly, both] = toReviewItems(
            [upload('a', 'a.pdf'), upload('b', 'b.pdf')],
            [result('a.pdf', { name_conflict: true }), result('b.pdf', { name_conflict: true, content: { where: 'trash' } })],
        );

        expect(needsConflictChoice(nameOnly!, false)).toBe(true);
        expect(needsConflictChoice(both!, false)).toBe(false);
        expect(needsConflictChoice(both!, true)).toBe(true);
    });

    it('keeps only the files that were not skipped', () => {
        const queued = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

        expect([...toKeptIds(queued, ['b'])]).toEqual(['a', 'c']);
        expect(toKeptIds(queued, ['a', 'b', 'c']).size).toBe(0);
        expect(toKeptIds(queued, []).size).toBe(3);
    });

    it('breadcrumbs a path', () => {
        expect(toBreadcrumb(['A', 'B'])).toBe('A › B');
    });
});
