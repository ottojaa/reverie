import { describe, expect, it } from 'vitest';
import { foldLabel, groupFolderId, recentEntries, recentRows, rowDocumentIds, stackLabel, type RecentDoc, type RecentRow } from './recent-rows';

const BASE = Date.parse('2026-11-23T12:00:00Z');
const at = (minutesAgo: number) => new Date(BASE - minutesAgo * 60_000).toISOString();

function doc(id: string, mime: string, created: string, name: string): RecentDoc {
    return { id, mime_type: mime, created_at: created, original_filename: name };
}

const photo = (id: string, minutesAgo: number) => doc(id, 'image/jpeg', at(minutesAgo), `IMG_${id}.jpg`);
const video = (id: string, minutesAgo: number) => doc(id, 'video/mp4', at(minutesAgo), `VID_${id}.mp4`);
const file = (id: string, minutesAgo: number, name = `${id}.pdf`) => doc(id, 'application/pdf', at(minutesAgo), name);
const photoAt = (id: string, secondsAgo: number) => doc(id, 'image/jpeg', new Date(BASE - secondsAgo * 1000).toISOString(), `IMG_${id}.jpg`);

/** "a" for a single, "F[a,b]" for a fold, "S[a,b]" for a stack. */
function shape(rows: RecentRow<RecentDoc>[]): string[] {
    return rows.map((row) => (row.type === 'single' ? row.doc.id : `${row.groupKind === 'fold' ? 'F' : 'S'}[${row.docs.map((d) => d.id).join(',')}]`));
}

const sizes = (rows: RecentRow<RecentDoc>[]) => rows.map((row) => (row.type === 'group' ? row.docs.length : 1));

describe('recentRows folding', () => {
    it('folds media within ten minutes of its neighbour, and a chain keeps growing', () => {
        expect(shape(recentRows([photo('a', 0), photo('b', 8), video('c', 16), photo('d', 40)]))).toEqual(['F[a,b,c]', 'd']);
    });

    it('splits folds on a gap over ten minutes and leaves a lone media single', () => {
        expect(shape(recentRows([photo('a', 0), photo('b', 3), photo('c', 14), photo('d', 30)]))).toEqual(['F[a,b]', 'c', 'd']);
    });

    it('treats exactly ten minutes as chained', () => {
        expect(shape(recentRows([photo('a', 0), photo('b', 10)]))).toEqual(['F[a,b]']);
    });

    it('never folds files with media or with each other', () => {
        expect(shape(recentRows([file('a', 0), photo('b', 1), file('c', 2), photo('d', 3)]))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('keys a fold by its newest member, so a page that extends it keeps the row', () => {
        const page1 = [photo('a', 0), photo('b', 5), photo('c', 100)];
        const before = recentRows(page1);
        const after = recentRows([...page1, photo('d', 104)]);

        expect(shape(after)).toEqual(['F[a,b]', 'F[c,d]']);
        // c was a single before and keeps the same key once d joins it.
        expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
    });

    it('never merges two folds that were already shown when a later page lands', () => {
        const page1 = [photo('a', 0), photo('b', 4), photo('c', 60), photo('d', 64)];

        expect(shape(recentRows(page1))).toEqual(['F[a,b]', 'F[c,d]']);
        expect(shape(recentRows([...page1, photo('e', 300)]))).toEqual(['F[a,b]', 'F[c,d]', 'e']);
    });

    it('caps a fold at thirty members counted from the newest, and the rows above stay when more arrives', () => {
        const batch = Array.from({ length: 100 }, (_, i) => photoAt(`p${i}`, i * 5));
        const rows = recentRows(batch);

        expect(sizes(rows)).toEqual([30, 30, 30, 10]);
        expect(rows.map((row) => row.key)).toEqual(['p0', 'p30', 'p60', 'p90']);

        const more = recentRows([...batch, ...Array.from({ length: 35 }, (_, i) => photoAt(`p${100 + i}`, (100 + i) * 5))]);

        expect(sizes(more)).toEqual([30, 30, 30, 30, 15]);
        expect(more.slice(0, 3).map((row) => row.key)).toEqual(rows.slice(0, 3).map((row) => row.key));
    });

    it('leaves the last member of a batch one over the cap single', () => {
        const rows = recentRows(Array.from({ length: 31 }, (_, i) => photoAt(`p${i}`, i * 5)));

        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({ type: 'single', key: 'p30' });
    });

    it('does not fold across a missing or unparsable date', () => {
        const broken = doc('b', 'image/jpeg', 'not a date', 'b.jpg');

        expect(shape(recentRows([photo('a', 0), broken, photo('c', 1)]))).toEqual(['a', 'b', 'c']);
    });
});

describe('recentRows stacking', () => {
    it("stacks files with exactly the same name at the newest copy's position", () => {
        const docs = [file('a', 0, 'x.apk'), file('n1', 5, 'notes.md'), file('b', 10, 'x.apk'), file('c', 20, 'x.apk'), file('n2', 30, 'other.md')];

        expect(shape(recentRows(docs))).toEqual(['S[a,b,c]', 'n1', 'n2']);
    });

    it('does not stack names that differ in case or extension', () => {
        expect(shape(recentRows([file('a', 0, 'x.apk'), file('b', 5, 'X.apk'), file('c', 10, 'x.apk.zip')]))).toEqual(['a', 'b', 'c']);
    });

    it('lets a stack gain older copies from a later page without moving the rows above it', () => {
        const page1 = [file('a', 0, 'x.apk'), file('n', 5, 'n.md'), file('b', 10, 'x.apk')];
        const page2 = [...page1, file('c', 500, 'x.apk'), file('m', 600, 'm.md')];

        expect(shape(recentRows(page1))).toEqual(['S[a,b]', 'n']);
        expect(shape(recentRows(page2))).toEqual(['S[a,b,c]', 'n', 'm']);
        expect(
            recentRows(page2)
                .map((row) => row.key)
                .slice(0, 2),
        ).toEqual(recentRows(page1).map((row) => row.key));
    });

    it('does not stack media with the same name', () => {
        const docs = [doc('a', 'image/png', at(0), 'Screenshot.png'), file('n', 30, 'n.md'), doc('b', 'image/png', at(60), 'Screenshot.png')];

        expect(shape(recentRows(docs))).toEqual(['a', 'n', 'b']);
    });

    it('lets a stacked older copy still separate the media on either side of it', () => {
        expect(shape(recentRows([photo('a', 0), file('x', 2, 'x.apk'), photo('b', 4), file('y', 6, 'x.apk')]))).toEqual(['a', 'S[x,y]', 'b']);
    });
});

describe('recentEntries and rowDocumentIds', () => {
    const rows = recentRows([photo('a', 0), photo('b', 1), file('c', 90)]);

    it('lists the members of an expanded group under it', () => {
        const entries = recentEntries(rows, new Set(['a']));

        expect(entries.map((entry) => entry.key)).toEqual(['a', 'member:a', 'member:b', 'c']);
        expect(entries[0]).toMatchObject({ type: 'row', expanded: true });
        expect(recentEntries(rows, new Set()).map((entry) => entry.key)).toEqual(['a', 'c']);
    });

    it('stands a row for all its loaded members', () => {
        expect(rowDocumentIds(rows[0]!)).toEqual(['a', 'b']);
        expect(rowDocumentIds(rows[1]!)).toEqual(['c']);
    });
});

describe('labels', () => {
    const today = new Date('2026-11-23T12:00:00Z');
    const zone = 'UTC';

    it('name the kind without a count', () => {
        expect(foldLabel([video('a', 0), video('b', 1)], today, zone)).toBe('Videos · Nov 23');
        expect(foldLabel([photo('a', 0), video('b', 1)], today, zone)).toBe('Photos and videos · Nov 23');
        expect(foldLabel([photo('a', 0), photo('b', 1)], today, zone)).toBe('Photos · Nov 23');
    });

    it('put the year on a day outside the current one', () => {
        const old = [doc('a', 'image/jpeg', '2025-11-06T10:00:00Z', 'a.jpg'), doc('b', 'image/jpeg', '2025-11-06T09:55:00Z', 'b.jpg')];

        expect(foldLabel(old, today, zone)).toBe('Photos · Nov 6, 2025');
    });

    it('span the days of a stack, oldest to newest', () => {
        const copy = (id: string, created: string) => doc(id, 'application/vnd.android.package-archive', created, 'x.apk');

        expect(stackLabel([copy('b', '2026-08-25T10:00:00Z'), copy('a', '2026-08-19T10:00:00Z')], today, zone)).toBe('Versions · Aug 19 – 25');
        expect(stackLabel([copy('b', '2026-09-02T10:00:00Z'), copy('a', '2026-08-19T10:00:00Z')], today, zone)).toBe('Versions · Aug 19 – Sep 2');
        expect(stackLabel([copy('b', '2026-08-19T12:00:00Z'), copy('a', '2026-08-19T10:00:00Z')], today, zone)).toBe('Versions · Aug 19');
    });

    it('carry the year on both ends of a stack that crosses years', () => {
        const copy = (id: string, created: string) => doc(id, 'application/zip', created, 'x.zip');

        expect(stackLabel([copy('b', '2026-01-03T10:00:00Z'), copy('a', '2025-12-28T10:00:00Z')], today, zone)).toBe('Versions · Dec 28, 2025 – Jan 3, 2026');
    });

    it('read the day in the given zone', () => {
        const late = [doc('a', 'image/jpeg', '2026-11-22T23:30:00Z', 'a.jpg'), doc('b', 'image/jpeg', '2026-11-22T23:20:00Z', 'b.jpg')];

        expect(foldLabel(late, today, 'Europe/Helsinki')).toBe('Photos · Nov 23');
    });
});

describe('groupFolderId', () => {
    const inFolder = (d: RecentDoc, folder: string | null) => ({ ...d, folder_id: folder });
    const group = (kind: 'fold' | 'stack', docs: ReturnType<typeof inFolder>[]) => ({ type: 'group' as const, key: docs[0]!.id, groupKind: kind, docs });

    it("names the folder a fold's members share", () => {
        expect(groupFolderId(group('fold', [inFolder(photo('a', 0), 'f1'), inFolder(photo('b', 1), 'f1')]))).toBe('f1');
    });

    it('names none for a fold across folders, since no one folder is the right one', () => {
        expect(groupFolderId(group('fold', [inFolder(photo('a', 0), 'f1'), inFolder(photo('b', 1), 'f2')]))).toBeNull();
    });

    it("names a stack's newest copy's folder, as its size is the newest copy's", () => {
        expect(groupFolderId(group('stack', [inFolder(file('a', 0, 'x.apk'), 'f1'), inFolder(file('b', 5, 'x.apk'), 'f2')]))).toBe('f1');
    });
});
