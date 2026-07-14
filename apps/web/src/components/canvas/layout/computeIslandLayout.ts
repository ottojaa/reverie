import type { FolderWithChildren } from '@reverie/shared';
import type { IslandLayout, PlanePosition } from '../types.js';

/**
 * Deterministic auto-layout: collections become clusters placed on an
 * expanding spiral (greedy, collision-checked), and every folder inside a
 * collection becomes an island arranged in a phyllotaxis pattern within its
 * cluster. Top-level folders without a collection share a synthetic cluster.
 * Same tree in → same layout out, across sessions and machines.
 */

const GOLDEN_ANGLE = 2.399963229728653;
const ISLAND_SPACING = 1.9; // multiplier on max island radius within a cluster
const CLUSTER_MARGIN = 14;
const JITTER = 0.35;

/** djb2 → [0, 1); seeds deterministic jitter so layouts are stable per id. */
export function hash01(seed: string): number {
    let h = 5381;

    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    }

    return ((h >>> 0) % 100000) / 100000;
}

export function islandRadius(documentCount: number): number {
    return Math.min(6, 2.2 + Math.sqrt(documentCount) * 0.28);
}

interface Cluster {
    collectionId: string | null;
    collectionName: string | null;
    folders: FolderWithChildren[];
}

function flattenFolders(nodes: FolderWithChildren[], out: FolderWithChildren[] = []): FolderWithChildren[] {
    for (const node of nodes) {
        out.push(node);
        flattenFolders(node.children ?? [], out);
    }

    return out;
}

function toClusters(tree: FolderWithChildren[]): Cluster[] {
    const sorted = [...tree].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const clusters: Cluster[] = [];
    const loose: FolderWithChildren[] = [];

    for (const node of sorted) {
        if (node.type === 'collection') {
            clusters.push({ collectionId: node.id, collectionName: node.name, folders: flattenFolders(node.children ?? []) });
        } else {
            loose.push(node, ...flattenFolders(node.children ?? []));
        }
    }

    if (loose.length > 0) {
        clusters.push({ collectionId: null, collectionName: null, folders: loose });
    }

    return clusters.filter((c) => c.folders.length > 0);
}

/**
 * Island offsets within a cluster. Small clusters get deliberate shapes —
 * a centered row (≤3) or an even ring (≤8) — because phyllotaxis reads as
 * misaligned clutter at low counts; larger clusters use the spiral.
 */
function islandOffsets(n: number, maxRadius: number): PlanePosition[] {
    if (n === 1) return [{ x: 0, z: 0 }];

    const spacing = maxRadius * ISLAND_SPACING;

    if (n <= 3) {
        return Array.from({ length: n }, (_, j) => ({ x: (j - (n - 1) / 2) * spacing * 1.15, z: 0 }));
    }

    if (n <= 8) {
        const ringRadius = spacing * (0.85 + n * 0.09);

        return Array.from({ length: n }, (_, j) => {
            const a = -Math.PI / 2 + (j * 2 * Math.PI) / n;

            return { x: Math.cos(a) * ringRadius, z: Math.sin(a) * ringRadius };
        });
    }

    return Array.from({ length: n }, (_, j) => {
        const r = spacing * Math.sqrt(j + 0.6);
        const a = GOLDEN_ANGLE * j;

        return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    });
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
    const clusters = toClusters(tree);

    const perCluster = clusters.map((cluster) => {
        const folders = [...cluster.folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
        const maxRadius = Math.max(...folders.map((f) => islandRadius(f.document_count)));
        const offsets = islandOffsets(folders.length, maxRadius);
        const clusterRadius = maxRadius * ISLAND_SPACING * Math.sqrt(folders.length + 0.6) + maxRadius;

        return { cluster, folders, offsets, clusterRadius };
    });

    const centers = placeClusters(perCluster.map((c) => c.clusterRadius));

    return perCluster.flatMap(({ cluster, folders, offsets }, k) => {
        const center = centers[k] ?? { x: 0, z: 0 };

        return folders.map((folder, j) => {
            const offset = offsets[j] ?? { x: 0, z: 0 };
            const radius = islandRadius(folder.document_count);
            const jx = (hash01(folder.id + ':x') - 0.5) * radius * JITTER;
            const jz = (hash01(folder.id + ':z') - 0.5) * radius * JITTER;

            return {
                id: folder.id,
                name: folder.name,
                emoji: folder.emoji ?? null,
                documentCount: folder.document_count,
                position: { x: center.x + offset.x + jx, z: center.z + offset.z + jz },
                radius,
                collectionId: cluster.collectionId,
                collectionName: cluster.collectionName,
            };
        });
    });
}
