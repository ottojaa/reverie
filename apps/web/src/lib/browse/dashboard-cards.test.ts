import type { DocumentSummaryResponse } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { dashboardCards, typeBlockCells, typeBlockColumns } from './dashboard-cards';

function summary(photos = 38, videos = 19, files = 191): DocumentSummaryResponse {
    return {
        image: { count: photos, bytes: photos * 1000 },
        video: { count: videos, bytes: videos * 5000 },
        file: {
            count: files,
            bytes: files * 100,
            top_types: [
                { ext: 'apk', count: 90 },
                { ext: 'zip', count: 20 },
            ],
        },
    };
}

const kinds = (s: DocumentSummaryResponse) => dashboardCards(s).map((card) => card.kind);

describe('dashboardCards', () => {
    it('draws Photos, Videos and Files in that order', () => {
        expect(kinds(summary())).toEqual(['image', 'video', 'file']);
    });

    it('draws no card for a kind with nothing in scope, so the rest share the row', () => {
        expect(kinds(summary(0))).toEqual(['video', 'file']);
        expect(kinds(summary(38, 0))).toEqual(['image', 'file']);
        expect(kinds(summary(38, 19, 0))).toEqual(['image', 'video']);
    });

    it('has a lone card when only one kind is present, and none for an empty scope', () => {
        expect(kinds(summary(0, 0))).toEqual(['file']);
        expect(kinds(summary(0, 0, 0))).toEqual([]);
    });

    it("carries the summary's count and bytes, and the file types only on Files", () => {
        const [photos, , files] = dashboardCards(summary());

        expect(photos).toMatchObject({ kind: 'image', count: 38, bytes: 38_000, topTypes: [] });
        expect(files).toMatchObject({ kind: 'file', count: 191, bytes: 19_100 });
        expect(files!.topTypes.map((type) => type.ext)).toEqual(['apk', 'zip']);
    });
});

describe('type blocks', () => {
    const types = (n: number) => ['apk', 'zip', 'md', 'pdf'].slice(0, n).map((ext) => ({ ext, count: 1 }));

    it('fill the card with one type, sit side by side with two, and make a 2×2 with three or four', () => {
        expect(typeBlockColumns(types(1))).toBe(1);
        expect(typeBlockColumns(types(2))).toBe(2);
        expect(typeBlockCells(types(1))).toHaveLength(1);
        expect(typeBlockCells(types(2))).toHaveLength(2);
        expect(typeBlockCells(types(4))).toHaveLength(4);
    });

    it('leave the fourth cell of three types neutral', () => {
        expect(typeBlockCells(types(3)).map((cell) => cell?.ext ?? null)).toEqual(['apk', 'zip', 'md', null]);
    });

    it('show one neutral block when no type is known', () => {
        expect(typeBlockCells([])).toEqual([null]);
        expect(typeBlockColumns([])).toBe(1);
    });
});
