import type { CameraState, CameraTuning } from '../types.js';

/**
 * Module-level transient store for the canvas scene.
 *
 * Per-frame animation state lives here as plain mutable objects so useFrame
 * can read/write without React re-renders (zero setState in the hot path).
 * The few facts React needs to see are pushed out through explicit callbacks
 * (onUnravelChange etc.); the snapshot is read imperatively per frame.
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
export const tuning: CameraTuning = { panSpeed: 1, zoomSpeed: 1, friction: 1, unravelDistance: 1, unravelRadius: 1, debugUnravel: false };

let snapshot: CanvasSnapshot = { unraveledFolderId: null, divePhase: 'idle' };

export function getCanvasSnapshot(): CanvasSnapshot {
    return snapshot;
}

export function patchCanvasSnapshot(patch: Partial<CanvasSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
}

/**
 * Reset transient state on scene mount (route re-entry). When returning from
 * a document dive, the previously open fan is seeded fully open (current ===
 * target === 1) so it renders open on the first frame behind the return
 * shield — restoring the view without replaying the unravel animation.
 * Runs in CanvasScene's render body, so it must stay idempotent under
 * StrictMode double-renders (it is: both runs seed identically from props).
 */
export function resetCanvasStore(initialCamera: CameraState | null, initialUnraveledFolderId: string | null): void {
    const start = initialCamera ?? DEFAULT_CAMERA;
    cam.target = { ...start };
    cam.current = { ...start };
    cam.vel = { x: 0, z: 0 };
    unravelAnims.clear();
    hover.docId = null;
    zoomBand.current = initialUnraveledFolderId ? 1 : 0;
    zoomBand.target = zoomBand.current;
    unravelRequest.current = null;

    if (initialUnraveledFolderId) unravelAnims.set(initialUnraveledFolderId, { current: 1, target: 1 });

    patchCanvasSnapshot({ unraveledFolderId: initialUnraveledFolderId, divePhase: 'idle' });
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
export const hover = { docId: null as string | null, lift: new Map<string, number>() };

/**
 * Eased 0→1 "inside the unravel zoom band" value, damped once per frame by
 * UnravelController (mounted before the islands, so consumers read the
 * current frame's value). Drives the semantic-zoom LOD: folder glyphs
 * outside the band crossfade into preview piles inside it. `target` (the
 * undamped 0/1 the value chases) tells consumers the band's direction —
 * the glyph↔pile choreography uses different band-space constants per
 * direction so the exit mirrors the enter in wall-clock (the damper spends
 * its fast half near the start of whichever way it's going).
 */
export const zoomBand = { current: 0, target: 0 };

/**
 * Explicit fan-out intent: set by an island click, the ?focus deep link, or
 * back-nav restore; consumed by UnravelController, which opens the island
 * once the camera arrives on it (or right away when `immediate`). Folders
 * only ever open through this — there is no proximity auto-open. Cancelled
 * by any manual camera input, click-away, or zoom-to-fit.
 */
export const unravelRequest = { current: null as { islandId: string; immediate: boolean } | null };

/**
 * Live canvas aspect (width/height), synced from R3F size by ViewportSync in
 * the scene. Device state, deliberately NOT reset by resetCanvasStore. Read
 * by the fan layout so narrow (portrait) screens get fewer columns.
 */
export const viewport = { aspect: 16 / 9 };

/** Screen position of the last pointerdown — lets click handlers ignore pan-releases. */
export const lastPointerDown = { x: 0, y: 0 };

/**
 * Live island-drag state. Set by the plate's pointer handlers (R3F synthetic
 * events fire before CameraRig's native listeners, which check this to skip
 * panning); groups follow it per frame; commit happens on release.
 */
export const islandDrag = { id: null as string | null, x: 0, z: 0 };
