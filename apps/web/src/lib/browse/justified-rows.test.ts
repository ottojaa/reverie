import type { Document } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { aspectOf, packJustifiedRows, tileColumns, tileSize } from './justified-rows';

function pic(id: string, aspect: number | null): Document {
    return { id, width: aspect === null ? null : aspect * 1000, height: aspect === null ? null : 1000 } as Document;
}

const ids = (docs: Document[]) => docs.map((d) => d.id);

describe('aspectOf', () => {
    it('is width over height', () => {
        expect(aspectOf({ width: 3000, height: 2000 })).toBe(1.5);
        expect(aspectOf({ width: 1000, height: 2000 })).toBe(0.5);
    });

    it('is 4:3 without usable dimensions', () => {
        expect(aspectOf({ width: null, height: null })).toBeCloseTo(4 / 3);
        expect(aspectOf({ width: 0, height: 500 })).toBeCloseTo(4 / 3);
        expect(aspectOf({ width: 500, height: 0 })).toBeCloseTo(4 / 3);
    });
});

describe('packJustifiedRows', () => {
    it('closes a row once it is wide enough and scales it to fill the width exactly', () => {
        // At 200px tall these are 400 + 400 + 450 = 1250px, over the 1000px row, so the row shrinks to 160px.
        const rows = packJustifiedRows([pic('a', 2), pic('b', 2), pic('c', 2.25)], { width: 1000, targetHeight: 200, gap: 0 });

        expect(rows).toHaveLength(1);
        expect(ids(rows[0]!.documents)).toEqual(['a', 'b', 'c']);
        expect(rows[0]!.height).toBe(160);
        expect(rows[0]!.widths).toEqual([320, 320, 360]);
    });

    it('leaves the picture that crosses the width for the next row when that keeps the row nearer the target', () => {
        // With the 4:1 panorama the row would be 1000 / 8 = 125px (75 under the 200px target); without it, 1000 / 4 = 250px (50 over).
        const rows = packJustifiedRows([pic('a', 2), pic('b', 2), pic('wide', 4)], { width: 1000, targetHeight: 200, gap: 0 });

        expect(ids(rows[0]!.documents)).toEqual(['a', 'b']);
        expect(rows[0]!.height).toBe(250);
        expect(rows[0]!.widths).toEqual([500, 500]);
        // The panorama starts the next row, which has nothing to fill it, so it stays at the target height.
        expect(ids(rows[1]!.documents)).toEqual(['wide']);
        expect(rows[1]!.height).toBe(200);
        expect(rows[1]!.widths).toEqual([800]);
    });

    it('keeps the crossing picture when that is nearer the target', () => {
        // 1000 / 6.25 = 160px (40 under) beats 1000 / 4 = 250px (50 over).
        const rows = packJustifiedRows([pic('a', 2), pic('b', 2), pic('c', 2.25)], { width: 1000, targetHeight: 200, gap: 0 });

        expect(ids(rows[0]!.documents)).toEqual(['a', 'b', 'c']);
    });

    it('takes the gaps out of the width the pictures share', () => {
        // 2 gaps of 8 leave 1000px for 6.25 aspect units: 160px tall, the same widths as without gaps.
        const rows = packJustifiedRows([pic('a', 2), pic('b', 2), pic('c', 2.25)], { width: 1016, targetHeight: 200, gap: 8 });

        expect(rows[0]!.height).toBe(160);
        expect(rows[0]!.widths).toEqual([320, 320, 360]);
        expect(rows[0]!.widths.reduce((sum, w) => sum + w, 0) + 16).toBe(1016);
    });

    it('starts the next row after a full one and leaves the last row at the target height', () => {
        const rows = packJustifiedRows([pic('a', 2), pic('b', 1), pic('c', 2), pic('d', 1), pic('e', 1)], { width: 1000, targetHeight: 200, gap: 0 });

        // a + b + c = 400 + 200 + 400 = 1000px exactly: a full row at the target height.
        expect(ids(rows[0]!.documents)).toEqual(['a', 'b', 'c']);
        expect(rows[0]!.height).toBe(200);
        expect(rows[0]!.widths).toEqual([400, 200, 400]);
        // d + e = 400px: not enough to fill, so it is not stretched.
        expect(ids(rows[1]!.documents)).toEqual(['d', 'e']);
        expect(rows[1]!.height).toBe(200);
        expect(rows[1]!.widths).toEqual([200, 200]);
    });

    it('draws pictures without dimensions as 4:3', () => {
        const rows = packJustifiedRows([pic('a', null), pic('b', null)], { width: 800, targetHeight: 300, gap: 0 });

        expect(rows).toHaveLength(1);
        expect(rows[0]!.height).toBeCloseTo(300);
        expect(rows[0]!.widths[0]).toBeCloseTo(400);
        expect(rows[0]!.widths[1]).toBeCloseTo(400);
    });

    it('gives a picture wider than the row a row of its own', () => {
        const rows = packJustifiedRows([pic('a', 5), pic('b', 1)], { width: 1000, targetHeight: 200, gap: 0 });

        expect(ids(rows[0]!.documents)).toEqual(['a']);
        expect(rows[0]!.height).toBe(200);
        expect(rows[0]!.widths).toEqual([1000]);
        expect(ids(rows[1]!.documents)).toEqual(['b']);
        expect(rows[1]!.widths).toEqual([200]);
    });

    it('packs nothing without a width or documents', () => {
        expect(packJustifiedRows([pic('a', 1)], { width: 0 })).toEqual([]);
        expect(packJustifiedRows([], { width: 1000 })).toEqual([]);
    });
});

describe('tileColumns and tileSize', () => {
    it('fits 6 tiles in the 976px a 1280px window leaves and shrinks on narrow ones', () => {
        expect(tileColumns(976)).toBe(6);
        expect(tileColumns(1700)).toBe(11);
        expect(tileColumns(600)).toBe(3);
        expect(tileColumns(320)).toBe(2);
        expect(tileColumns(100)).toBe(2);
    });

    it('shares the width between the tiles and their gaps', () => {
        expect(tileSize(1004, 6, 4)).toBe(164);
        expect(tileSize(1000, 2, 0)).toBe(500);
    });
});
