import type { FolderWithChildren } from '@reverie/shared';
import { toOwnCount } from '../../../lib/folders/tree.js';
import type { IslandLayout, PlanePosition } from '../types.js';

/**
 * Deterministic auto-layout: each top-level folder becomes a cluster placed on
 * an expanding spiral (greedy, collision-checked), and that folder and every
 * folder beneath it becomes a uniform island in a centered, row-major grid —
 * same size, aligned left to right, each folder before its subfolders. Same
 * tree in → same layout out, across sessions and machines.
 */

const GOLDEN_ANGLE = 2.399963229728653;
/** One size for every island — mixed sizes read as misalignment, not meaning. */
export const ISLAND_RADIUS = 3.2;
const ISLAND_SPACING = 1.9; // multiplier on island radius within a cluster
const GRID_COLS = 5;
const CLUSTER_MARGIN = 14;

/** djb2 → [0, 1); seeds deterministic per-id variation (e.g. pile jitter). */
export function hash01(seed: string): number {
    let h = 5381;

    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    }

    return ((h >>> 0) % 100000) / 100000;
}

/** The folders in reading order: siblings by position then name, each folder before its subfolders. */
function toReadingOrder(folders: FolderWithChildren[]): FolderWithChildren[] {
    const siblings = [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    return siblings.flatMap((folder) => [folder, ...toReadingOrder(folder.children)]);
}

const PITCH_X = ISLAND_RADIUS * ISLAND_SPACING * 1.15;
// Taller pitch so a row's name/count labels never crowd the next row.
const PITCH_Z = ISLAND_RADIUS * ISLAND_SPACING * 1.7;

/**
 * Row-major centered grid (≤GRID_COLS per row), partial last row centered
 * too — reading order, everything aligned.
 */
function islandOffsets(n: number): PlanePosition[] {
    const cols = Math.min(n, GRID_COLS);
    const rows = Math.ceil(n / cols);

    return Array.from({ length: n }, (_, j) => {
        const row = Math.floor(j / cols);
        const rowCount = row === rows - 1 ? n - row * cols : cols;

        return { x: ((j % cols) - (rowCount - 1) / 2) * PITCH_X, z: (row - (rows - 1) / 2) * PITCH_Z };
    });
}

/** Half-diagonal of the cluster's grid, for cluster-vs-cluster spacing. */
function clusterRadiusFor(n: number): number {
    const cols = Math.min(n, GRID_COLS);
    const rows = Math.ceil(n / cols);

    return Math.hypot(((cols - 1) / 2) * PITCH_X, ((rows - 1) / 2) * PITCH_Z) + ISLAND_RADIUS + 2;
}

/** Greedy spiral placement of cluster centers with collision checks. */
function placeClusters(radii: number[]): PlanePosition[] {
    const placed: { x: number; z: number; r: number }[] = [];

    return radii.map((r, k) => {
        if (k === 0) {
            placed.push({ x: 0, z: 0, r });

            return { x: 0, z: 0 };
        }

        for (let t = 1; t < 2000; t += 0.25) {
            const x = Math.cos(GOLDEN_ANGLE * t) * 5 * t;
            const z = Math.sin(GOLDEN_ANGLE * t) * 5 * t;

            if (placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + r + CLUSTER_MARGIN)) {
                placed.push({ x, z, r });

                return { x, z };
            }
        }

        // Spiral exhausted (pathological input) — stack far out rather than overlap.
        const fallback = { x: 0, z: (placed.length + 1) * (2 * r + CLUSTER_MARGIN) };
        placed.push({ ...fallback, r });

        return fallback;
    });
}

export function computeIslandLayout(tree: FolderWithChildren[]): IslandLayout[] {
    const roots = [...tree].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const clusters = roots.map((root) => ({ root, folders: toReadingOrder([root]) }));
    const centers = placeClusters(clusters.map((cluster) => clusterRadiusFor(cluster.folders.length)));

    return clusters.flatMap(({ root, folders }, k) => {
        const center = centers[k] ?? { x: 0, z: 0 };
        const offsets = islandOffsets(folders.length);

        return folders.map((folder, j) => {
            const offset = offsets[j] ?? { x: 0, z: 0 };

            return {
                id: folder.id,
                name: folder.name,
                emoji: folder.emoji ?? null,
                documentCount: toOwnCount(folder),
                position: { x: center.x + offset.x, z: center.z + offset.z },
                radius: ISLAND_RADIUS,
                clusterId: root.id,
                clusterName: root.name,
            };
        });
    });
}
