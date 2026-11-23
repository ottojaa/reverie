import type { Document } from '@reverie/shared';

/** What a picture without known dimensions is drawn as: the 4:3 the cards use. */
const FALLBACK_ASPECT = 4 / 3;

/** Smallest tile of the square grid, in px; the column count is whatever fits. */
const MIN_TILE = 150;
const MIN_TILE_COLUMNS = 2;

/** Space between tiles (and between rows of tiles) in the Grid and Justified layouts, in px. */
export const TILE_GAP = 4;

/** Height Justified rows aim for, in px; a full row is scaled so its pictures fill the width exactly. */
export const JUSTIFIED_TARGET_HEIGHT = 220;

export interface JustifiedRow {
    documents: Document[];
    /** Width of each document's box, same order as `documents`. */
    widths: number[];
    height: number;
}

/** Width over height of a document's picture; 4:3 when the list row has no (usable) dimensions. */
export function aspectOf(doc: Pick<Document, 'width' | 'height'>): number {
    if (!doc.width || !doc.height || doc.width < 0 || doc.height < 0) return FALLBACK_ASPECT;

    return doc.width / doc.height;
}

/** The height a run of pictures with this aspect sum has when it is scaled to fill `width` exactly. */
function fillHeight(aspectSum: number, count: number, width: number, gap: number): number {
    return (width - gap * (count - 1)) / aspectSum;
}

/**
 * Packs `documents` (in order) into rows that keep every picture's aspect ratio: a row takes pictures until they are
 * at least `width` wide at `targetHeight`, then scales to exactly `width`. The picture that crosses the width is kept
 * or left for the next row, whichever gives the row a height nearer the target (so one panorama does not squash a row).
 * The last row has nothing to fill it with and stays at the target height, left-aligned, instead of being blown up.
 */
export function packJustifiedRows(
    documents: Document[],
    { width, targetHeight = JUSTIFIED_TARGET_HEIGHT, gap = TILE_GAP }: { width: number; targetHeight?: number; gap?: number },
): JustifiedRow[] {
    if (width <= 0) return [];

    const rows: JustifiedRow[] = [];
    let run: Document[] = [];
    let runAspects: number[] = [];
    let aspectSum = 0;

    const closeRow = (height: number) => {
        rows.push({ documents: run, widths: runAspects.map((aspect) => aspect * height), height });
        run = [];
        runAspects = [];
        aspectSum = 0;
    };

    for (const doc of documents) {
        const aspect = aspectOf(doc);

        run.push(doc);
        runAspects.push(aspect);
        aspectSum += aspect;

        if (aspectSum * targetHeight + gap * (run.length - 1) < width) continue;

        const withLast = fillHeight(aspectSum, run.length, width, gap);

        if (run.length === 1) {
            closeRow(withLast);
            continue;
        }

        const withoutLast = fillHeight(aspectSum - aspect, run.length - 1, width, gap);

        if (Math.abs(withLast - targetHeight) <= Math.abs(withoutLast - targetHeight)) {
            closeRow(withLast);
            continue;
        }

        run.pop();
        runAspects.pop();
        closeRow(withoutLast);
        run = [doc];
        runAspects = [aspect];
        aspectSum = aspect;
    }

    if (run.length > 0) rows.push({ documents: run, widths: runAspects.map((aspect) => aspect * targetHeight), height: targetHeight });

    return rows;
}

/** How many square tiles fit a row of `width`: 6 at the 976px a 1280px window leaves, never fewer than two. */
export function tileColumns(width: number, gap: number = TILE_GAP): number {
    return Math.max(MIN_TILE_COLUMNS, Math.floor((width + gap) / (MIN_TILE + gap)));
}

/** Side of a square tile when `columns` of them share `width`. */
export function tileSize(width: number, columns: number, gap: number = TILE_GAP): number {
    return (width - gap * (columns - 1)) / columns;
}
