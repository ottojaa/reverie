import type { Group } from 'three';
import { maxUnravelValue } from './store.js';

/**
 * Focus dim: while a folder is unraveled, everything else on the plane
 * recedes toward this floor so the fan doesn't visually fight its neighbours.
 */
const FOCUS_DIM_FLOOR = 0.15;

type FadableMaterial = { opacity: number; transparent: boolean; userData: Record<string, unknown> };

/**
 * Multiply every material under a group by `factor`, relative to its authored
 * opacity (cached in userData on first touch so blobs/rings keep their base).
 */
export function applyGroupOpacity(group: Group, factor: number): void {
    group.traverse((child) => {
        const material = (child as unknown as { material?: FadableMaterial }).material;

        if (!material) return;

        const base = (material.userData.baseOpacity as number | undefined) ?? material.opacity;
        material.userData.baseOpacity = base;
        material.transparent = true;
        material.opacity = base * factor;
    });
}

/** 1 → dimmed floor as any OTHER folder unravels. */
export function focusDimFor(islandId: string | null): number {
    return 1 - (1 - FOCUS_DIM_FLOOR) * maxUnravelValue(islandId ?? undefined);
}
