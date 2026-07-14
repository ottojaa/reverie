import type { CameraState, CameraTuning } from '../types.js';

/**
 * Module-level transient store for the canvas scene.
 *
 * Per-frame animation state lives here as plain mutable objects so useFrame
 * can read/write without React re-renders (zero setState in the hot path).
 * The few facts React needs to see go through the snapshot + subscribe API
 * (useSyncExternalStore-compatible).
 */

export type DivePhase = 'idle' | 'flying' | 'handoff';

export interface CameraTransient {
    target: CameraState;
    current: CameraState;
    /** Pan inertia in world units/second, decays exponentially after release. */
    vel: { x: number; z: number };
}

export interface CanvasSnapshot {
    unraveledFolderId: string | null;
    divePhase: DivePhase;
}

const DEFAULT_CAMERA: CameraState = { x: 0, z: 0, zoom: 0.25 };

export const cam: CameraTransient = {
    target: { ...DEFAULT_CAMERA },
    current: { ...DEFAULT_CAMERA },
    vel: { x: 0, z: 0 },
};

/** User-adjustable canvas feel (persisted DOM-side, written via props). */
export const tuning: CameraTuning = { panSpeed: 1, zoomSpeed: 1, friction: 1, unravelDistance: 1 };

let snapshot: CanvasSnapshot = { unraveledFolderId: null, divePhase: 'idle' };
const listeners = new Set<() => void>();

export function getCanvasSnapshot(): CanvasSnapshot {
    return snapshot;
}

export function subscribeCanvasStore(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function patchCanvasSnapshot(patch: Partial<CanvasSnapshot>): void {
    const next = { ...snapshot, ...patch };
    const changed = next.unraveledFolderId !== snapshot.unraveledFolderId || next.divePhase !== snapshot.divePhase;

    if (!changed) return;

    snapshot = next;
    listeners.forEach((fn) => fn());
}

/** Reset transient state on scene mount (route re-entry). */
export function resetCanvasStore(initialCamera: CameraState | null): void {
    const start = initialCamera ?? DEFAULT_CAMERA;
    cam.target = { ...start };
    cam.current = { ...start };
    cam.vel = { x: 0, z: 0 };
    unravelAnims.clear();
    hover.docId = null;
    hover.islandId = null;
    unravelSuppression.clear();
    patchCanvasSnapshot({ unraveledFolderId: null, divePhase: 'idle' });
}

/** Highest unravel value across folders — drives the focus-dim of everything else. */
export function maxUnravelValue(exceptId?: string): number {
    let max = 0;

    unravelAnims.forEach((anim, id) => {
        if (id !== exceptId && anim.current > max) max = anim.current;
    });

    return max;
}

export function isDiving(): boolean {
    return snapshot.divePhase !== 'idle';
}

/** Per-folder unravel animation values (eased 0→1, ExposeStyle pattern). */
export interface UnravelAnim {
    current: number;
    target: number;
}

export const unravelAnims = new Map<string, UnravelAnim>();

export function unravelTarget(folderId: string, target: number): void {
    const anim = unravelAnims.get(folderId);

    if (anim) {
        anim.target = target;

        return;
    }

    if (target > 0) unravelAnims.set(folderId, { current: 0, target });
}

export function unravelValue(folderId: string): number {
    return unravelAnims.get(folderId)?.current ?? 0;
}

/** Transient hover state — read per frame by cards, never through React. */
export const hover = { docId: null as string | null, islandId: null as string | null, lift: new Map<string, number>() };

/**
 * Folders whose auto-unravel is suppressed (click-away collapse, back-nav
 * re-entry). A folder re-arms only once the camera has left its zone — so
 * the controller can't undo a deliberate collapse while the camera is still
 * parked on the folder. An explicit island click also clears its entry.
 */
export const unravelSuppression = new Set<string>();

/** Screen position of the last pointerdown — lets click handlers ignore pan-releases. */
export const lastPointerDown = { x: 0, y: 0 };

/**
 * Live island-drag state. Set by the plate's pointer handlers (R3F synthetic
 * events fire before CameraRig's native listeners, which check this to skip
 * panning); groups follow it per frame; commit happens on release.
 */
export const islandDrag = { id: null as string | null, x: 0, z: 0 };
