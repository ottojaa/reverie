import type { Document } from '@reverie/shared';

/** World-space position on the ground plane (three.js x/z, y is up). */
export interface PlanePosition {
    x: number;
    z: number;
}

/** A folder rendered as an island on the canvas plane. */
export interface IslandLayout {
    id: string;
    name: string;
    emoji: string | null;
    documentCount: number;
    position: PlanePosition;
    /** Approximate footprint radius in world units; drives plate size and camera fit. */
    radius: number;
    collectionId: string | null;
    collectionName: string | null;
}

/** Serializable camera state; zoom ∈ [0, 1] where 0 is the far overview. */
export interface CameraState {
    x: number;
    z: number;
    zoom: number;
}

/** User-adjustable canvas feel: multipliers around the built-in defaults. */
export interface CameraTuning {
    panSpeed: number;
    zoomSpeed: number;
    /** Higher = inertia dies faster; lower = longer glide. */
    friction: number;
    /** Multiplier on the zoom distance at which folders unravel (higher = from farther away). */
    unravelDistance: number;
    /** Multiplier on the center-zone radius that triggers a folder. */
    unravelRadius: number;
    /** Show the unravel gates: focus reticle + per-folder trigger circles. */
    debugUnravel: boolean;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
    panSpeed: 1,
    zoomSpeed: 1,
    friction: 1,
    unravelDistance: 1,
    unravelRadius: 1,
    debugUnravel: false,
};

export interface UnraveledFolder {
    folderId: string;
    documents: Document[];
    totalCount: number;
}

/**
 * The contract between the DOM shell (CanvasPage) and the WebGL scene.
 * Everything under scene/ is lazy-loaded; this file must stay three-free.
 */
export interface CanvasSceneProps {
    islands: IslandLayout[];
    previews: Record<string, Document[]>;
    unraveled: UnraveledFolder | null;
    /** From ?focus — the scene flies the camera to this island on mount. */
    focusFolderId: string | null;
    /** Restored session camera; wins over focus fly-in and auto-fit. */
    initialCamera: CameraState | null;
    /** True when this mount is a back-navigation from /document — plays the reverse dive. */
    returnDive: boolean;
    tuning: CameraTuning;
    onVisibleFoldersChange: (ids: string[]) => void;
    onApproachFolder: (folderId: string) => void;
    onUnravelChange: (folderId: string | null) => void;
    onIslandMoved: (folderId: string, position: PlanePosition) => void;
    onHoverDocument: (doc: Document) => void;
    /** Direct open without the dive (reduced motion). */
    onOpenDocument: (doc: Document) => void;
    /** Dive flight landed — mount the DOM overlay and navigate. */
    onDiveHandoff: (doc: Document) => void;
    onCameraChange: (state: CameraState) => void;
}

/** Imperative handle exposed to DOM chrome (zoom buttons). */
export interface CanvasSceneHandle {
    zoomBy: (delta: number) => void;
    zoomToFit: () => void;
}
