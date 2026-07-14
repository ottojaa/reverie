import type { PlanePosition } from '../types.js';

/**
 * Per-user island position overrides in localStorage. The `version` field
 * gates schema evolution; the planned DB-backed store replaces this module
 * behind the same useCanvasLayout contract.
 */
export interface CanvasLayoutStore {
    version: 1;
    positions: Record<string, PlanePosition>;
}

export const EMPTY_LAYOUT_STORE: CanvasLayoutStore = { version: 1, positions: {} };

export function canvasLayoutKey(userId: string): string {
    return 'reverie:canvas-layout:v1:' + userId;
}

/** Drop overrides for folders that no longer exist in the tree. */
export function pruneStalePositions(store: CanvasLayoutStore, validFolderIds: ReadonlySet<string>): CanvasLayoutStore {
    const stale = Object.keys(store.positions).filter((id) => !validFolderIds.has(id));

    if (stale.length === 0) return store;

    const positions = { ...store.positions };
    stale.forEach((id) => delete positions[id]);

    return { ...store, positions };
}
