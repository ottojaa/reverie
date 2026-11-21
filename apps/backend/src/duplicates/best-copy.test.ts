import { describe, expect, it } from 'vitest';
import { isEditedCopyName, pickBestCopy, type CopyCandidate } from './best-copy';

const copy = (id: string, extra: Partial<CopyCandidate> = {}): CopyCandidate => ({
    id,
    filename: id + '.jpg',
    width: 4000,
    height: 3000,
    date: new Date('2024-01-01T00:00:00Z'),
    ...extra,
});

describe('isEditedCopyName', () => {
    it.each([
        'IMG_1 (Copy).jpg',
        'IMG_1 (copy 2).jpg',
        'IMG_1 copy.jpg',
        'IMG_1-copy.jpg',
        'IMG_1_Copy2.jpg',
        'IMG_1 - Copy.jpg',
        'beach-edited.png',
        'IMG_1 (1).jpg',
    ])('sees %s as an edited copy', (name) => expect(isEditedCopyName(name)).toBe(true));

    it.each(['IMG_1.jpg', 'copyright.jpg', 'Copy of the plan.png', 'scan 2024.jpg', 'edited-by-hand notes.jpg', 'IMG_1(2)x.jpg'])(
        'sees %s as an original',
        (name) => expect(isEditedCopyName(name)).toBe(false),
    );
});

describe('pickBestCopy', () => {
    it('takes the largest resolution first, even over an older original', () => {
        const small = copy('a', { width: 1000, height: 1000, date: new Date('2020-01-01') });
        const large = copy('b', { filename: 'b (Copy).jpg', width: 3000, height: 2000 });

        expect(pickBestCopy([small, large])).toBe('b');
    });

    it('then prefers an original over an edited copy of the same size', () => {
        expect(pickBestCopy([copy('a', { filename: 'IMG (Copy).jpg', date: new Date('2020-01-01') }), copy('b')])).toBe('b');
    });

    it('then the oldest, and the id when even that is equal', () => {
        expect(pickBestCopy([copy('a', { date: new Date('2024-05-01') }), copy('b', { date: new Date('2023-05-01') })])).toBe('b');
        expect(pickBestCopy([copy('b'), copy('a')])).toBe('a');
    });

    it('counts an image of unknown size as the smallest', () => {
        expect(pickBestCopy([copy('a', { width: null, height: null }), copy('b', { width: 10, height: 10 })])).toBe('b');
    });

    it('does not change the list it is given, and refuses an empty group', () => {
        const list = [copy('b'), copy('a')];

        pickBestCopy(list);

        expect(list.map((c) => c.id)).toEqual(['b', 'a']);
        expect(() => pickBestCopy([])).toThrow('Cannot pick the best copy of an empty group');
    });
});
