import type { Document } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import { canvasQuality } from '../canvasQuality.js';
import type { IslandLayout } from '../types.js';
import { fanHalfExtents, fanLayout, fanMaxCols, stackSlot } from './unravel.js';

function doc(id: string): Document {
    return { id, width: 1600, height: 1200 } as Document;
}

function docs(n: number): Document[] {
    return Array.from({ length: n }, (_, i) => doc('doc-' + i));
}

const island: IslandLayout = {
    id: 'f1',
    name: 'Receipts',
    emoji: null,
    documentCount: 24,
    position: { x: 10, z: -4 },
    radius: 3,
    collectionId: null,
    collectionName: null,
};

// Grid pitches from unravel.ts: CELL_W + GAP_X and CELL_H + GAP_Y.
const COL_PITCH = 3.5 + 0.6;
const ROW_PITCH = 2.7 + 1.7;

describe('fanMaxCols', () => {
    it('caps columns on narrow viewports', () => {
        expect(fanMaxCols(390 / 844)).toBe(3); // portrait phone
        expect(fanMaxCols(1)).toBe(4); // squarish / split view
        expect(fanMaxCols(16 / 9)).toBe(Number.MAX_SAFE_INTEGER);
    });
});

describe('fanLayout', () => {
    it('uses a near-square grid when uncapped', () => {
        const poses = fanLayout(docs(24), island, Number.MAX_SAFE_INTEGER);
        const columns = new Set(poses.map((p) => p.fanned.x));
        const rows = new Set(poses.map((p) => p.fanned.z));

        expect(columns.size).toBe(5); // ceil(sqrt(24))
        expect(rows.size).toBe(5);
    });

    it('caps columns and grows rows on narrow viewports', () => {
        const poses = fanLayout(docs(24), island, 3);
        const columns = new Set(poses.map((p) => p.fanned.x));
        const rows = new Set(poses.map((p) => p.fanned.z));

        expect(columns.size).toBe(3);
        expect(rows.size).toBe(8);
    });

    it('scatters home poses within the island footprint, deterministically', () => {
        const four = docs(4);
        const poses = fanLayout(four, island, 2);

        expect(poses).toEqual(fanLayout(four, island, 2));
        poses.forEach((pose) => {
            expect(Math.abs(pose.home.x - island.position.x)).toBeLessThanOrEqual(island.radius * 0.25);
            expect(Math.abs(pose.home.z - island.position.z)).toBeLessThanOrEqual(island.radius * 0.25);
        });
    });
});

describe('fanHalfExtents', () => {
    it('tightly bounds the laid-out fan for the same maxCols', () => {
        for (const maxCols of [2, 3, Number.MAX_SAFE_INTEGER]) {
            const poses = fanLayout(docs(24), island, maxCols);
            const { halfW, halfH } = fanHalfExtents(24, maxCols);
            const maxX = Math.max(...poses.map((p) => Math.abs(p.fanned.x - island.position.x)));
            const maxZ = Math.max(...poses.map((p) => Math.abs(p.fanned.z - island.position.z)));

            // Bounds the outermost card centers, within half a cell pitch —
            // the framing math and the layout must never diverge.
            expect(halfW).toBeGreaterThan(maxX);
            expect(halfH).toBeGreaterThan(maxZ);
            expect(halfW - maxX).toBeLessThanOrEqual(COL_PITCH / 2 + 1e-9);
            expect(halfH - maxZ).toBeLessThanOrEqual(ROW_PITCH / 2 + 1e-9);
        }
    });

    it('clamps to the device fan page limit', () => {
        const before = canvasQuality.fanPageLimit;
        canvasQuality.fanPageLimit = 12;

        try {
            expect(fanHalfExtents(24, 3)).toEqual(fanHalfExtents(12, 3));
        } finally {
            canvasQuality.fanPageLimit = before;
        }
    });
});

describe('stackSlot', () => {
    it('is deterministic per document id', () => {
        expect(stackSlot(doc('a'), island)).toEqual(stackSlot(doc('a'), island));
    });

    it('keeps slots within the plate jitter radius', () => {
        for (let i = 0; i < 20; i++) {
            const slot = stackSlot(doc('jitter-' + i), island);

            expect(Math.abs(slot.dx)).toBeLessThanOrEqual(island.radius * 0.15);
            expect(Math.abs(slot.dz)).toBeLessThanOrEqual(island.radius * 0.15);
        }
    });
});
