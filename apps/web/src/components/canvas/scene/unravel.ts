import type { Document } from '@reverie/shared';
import { canvasQuality } from '../canvasQuality.js';
import { hash01 } from '../layout/computeIslandLayout.js';
import type { IslandLayout } from '../types.js';
import { PAN_LAMBDA } from './cameraMath.js';
import { cam, tuning, viewport } from './store.js';

/**
 * Unravel gate constants and the fan-out layout. Opening is explicit (a
 * click/deep-link request that fires on camera arrival); the zoom gates use a
 * hysteresis pair (enter < exit) so an open fan survives zooming out to see
 * all of it. The gating math lives here so the controller and the debug
 * overlay render the exact same conditions.
 */
export const UNRAVEL_ENTER_DIST = 44;
/** Generous exit so a fan survives zooming out far enough to see all of it. */
export const UNRAVEL_EXIT_DIST = 58;
export const APPROACH_DIST = 64;
/**
 * A requested open is deferred while the view sweeps faster than this
 * fraction of the camera distance per second — the click-to-open flight must
 * land and settle before the fan pops.
 */
export const MAX_OPEN_SWEEP = 0.4;

/**
 * The camera must be centered on the island for a requested open to fire.
 * The tolerance grows with camera distance — when zoomed out, "centered" is
 * coarser in world units. User-tunable via the "Unravel radius" slider.
 */
export function enterProximity(radius: number, dist: number): number {
    return (radius * 0.75 + 0.5 + dist * 0.06) * tuning.unravelRadius;
}

/**
 * How far the camera focus may wander from an OPEN folder before it
 * re-gathers: just past the fan itself (so browsing the fan's edge cards is
 * safe), never smaller than the enter zone (or it would collapse on open).
 */
export function unravelExitRadius(island: IslandLayout, dist: number): number {
    const { halfW, halfH } = fanHalfExtents(island.documentCount);

    return Math.max(Math.max(halfW, halfH) + 2, enterProximity(island.radius, dist) * 1.15);
}

/** Estimated view sweep: pan-damper lag plus inertia, relative to camera distance. */
export function viewSweep(dist: number): number {
    return (
        (Math.hypot(cam.target.x - cam.current.x, cam.target.z - cam.current.z) * PAN_LAMBDA + Math.hypot(cam.vel.x, cam.vel.z)) / Math.max(dist, 1)
    );
}

/** A flat card pose on the plane (y up, yaw = spin around vertical). */
export interface CardTransform {
    x: number;
    y: number;
    z: number;
    yaw: number;
    scale: number;
}

export interface CardPose {
    home: CardTransform;
    fanned: CardTransform;
    /** Letterboxed world size at fanned scale 1. */
    w: number;
    h: number;
}

const CELL_W = 3.5;
const CELL_H = 2.7;
const GAP_X = 0.6;
// Extra row spacing leaves room for the filename/date labels under each card.
const GAP_Y = 1.7;
const DEFAULT_ASPECT = 4 / 3;

/** How many pile cards the gathered island renders (IslandStack). */
export const STACK_COUNT = 3;

function cardSize(doc: Document): { w: number; h: number } {
    const aspect = doc.width && doc.height ? doc.width / doc.height : DEFAULT_ASPECT;
    const h = Math.min(CELL_H, CELL_W / aspect);

    return { w: h * aspect, h };
}

/**
 * Deterministic pile slot on the plate, hashed on doc.id — shared by the
 * resting pile meshes (IslandStack) and the fan cards' home pose, so
 * gathering cards land exactly where the pile fades in. Order-independent:
 * the previews query and the fan page may return docs in different orders,
 * but a given document always occupies the same slot.
 */
export function stackSlot(doc: Document, island: IslandLayout): { dx: number; dz: number; yaw: number; w: number; h: number } {
    const size = island.radius * 0.62;
    const aspect = doc.width && doc.height ? doc.width / doc.height : DEFAULT_ASPECT;
    const h = aspect >= 1 ? size / aspect : size;

    return {
        w: h * aspect,
        h,
        yaw: (hash01(doc.id + ':sy') - 0.5) * 0.5,
        dx: (hash01(doc.id + ':sx') - 0.5) * island.radius * 0.3,
        dz: (hash01(doc.id + ':sz') - 0.5) * island.radius * 0.3,
    };
}

/** Column cap so the fan fits the screen: portrait phones get a narrow grid. */
export function fanMaxCols(aspect: number = viewport.aspect): number {
    if (aspect < 0.8) return 3;

    if (aspect < 1.2) return 4;

    return Number.MAX_SAFE_INTEGER;
}

/**
 * Centered near-square grid (⌈√n⌉ columns, capped by maxCols on narrow
 * viewports, row-major) around the island, with each card letterboxed into
 * its cell — uniform scale, never stretched. Pure in (docs, island, maxCols),
 * so appended pages animate in naturally.
 */
export function fanLayout(docs: Document[], island: IslandLayout, maxCols: number = fanMaxCols()): CardPose[] {
    const n = docs.length;

    if (n === 0) return [];

    const cols = Math.min(Math.ceil(Math.sqrt(n)), Math.max(1, maxCols));
    const rows = Math.ceil(n / cols);
    const { x: cx, z: cz } = island.position;

    return docs.map((doc, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const { w, h } = cardSize(doc);

        return {
            home: {
                x: cx + (hash01(doc.id + ':hx') - 0.5) * island.radius * 0.5,
                y: 0.12 + i * 0.006,
                z: cz + (hash01(doc.id + ':hz') - 0.5) * island.radius * 0.5,
                yaw: (hash01(doc.id + ':hr') - 0.5) * 0.55,
                scale: 0.18,
            },
            fanned: {
                x: cx + (col - (cols - 1) / 2) * (CELL_W + GAP_X),
                y: 0.15 + i * 0.002,
                z: cz + (row - (rows - 1) / 2) * (CELL_H + GAP_Y),
                yaw: 0,
                scale: 1,
            },
            w,
            h,
        };
    });
}

/** Ripple stagger: card i trails the folder's unravel value slightly. */
export function cardProgress(unravelT: number, index: number): number {
    return Math.min(1, Math.max(0, unravelT * 1.15 - index * 0.02));
}

/** Approximate half extents of a folder's fanned grid, for camera framing. */
export function fanHalfExtents(documentCount: number, maxCols: number = fanMaxCols()): { halfW: number; halfH: number } {
    const n = Math.max(1, Math.min(documentCount, canvasQuality.fanPageLimit));
    const cols = Math.min(Math.ceil(Math.sqrt(n)), Math.max(1, maxCols));
    const rows = Math.ceil(n / cols);

    return { halfW: (cols * (CELL_W + GAP_X)) / 2, halfH: (rows * (CELL_H + GAP_Y)) / 2 };
}
