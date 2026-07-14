import type { Document } from '@reverie/shared';
import { hash01 } from '../layout/computeIslandLayout.js';
import type { IslandLayout } from '../types.js';
import { cam } from './store.js';

/**
 * Semantic-zoom constants and the fan-out layout. Zoom bands use hysteresis
 * pairs (enter < exit) plus a switch debounce so hovering at a threshold
 * breathes instead of flickering. The gating math lives here so the
 * controller and the debug overlay render the exact same conditions.
 */
export const UNRAVEL_ENTER_DIST = 44;
/** Generous exit so a fan survives zooming out far enough to see all of it. */
export const UNRAVEL_EXIT_DIST = 58;
export const APPROACH_DIST = 64;
export const SWITCH_DEBOUNCE_MS = 150;
/** The fan extends past the plate, so the centering exit stays generous. */
export const EXIT_SLACK = 14;
// CameraRig's pan damping constant — used to estimate the view's sweep speed.
const PAN_LAMBDA = 18;
/**
 * Opening is deferred while the view sweeps faster than this fraction of the
 * camera distance per second — panning across a cluster must not pop fans
 * open; stopping on a folder opens it right as the camera settles.
 */
export const MAX_OPEN_SWEEP = 0.4;

/**
 * Camera must be centered on the island to open it. The tolerance grows with
 * camera distance — when zoomed out, "centered" is coarser in world units,
 * and a fixed radius made distant unravels nearly impossible to aim.
 */
export function enterProximity(radius: number, dist: number): number {
    return radius * 0.75 + 0.5 + dist * 0.06;
}

/** Estimated view sweep: pan-damper lag plus inertia, relative to camera distance. */
export function viewSweep(dist: number): number {
    return (
        (Math.hypot(cam.target.x - cam.current.x, cam.target.z - cam.current.z) * PAN_LAMBDA + Math.hypot(cam.vel.x, cam.vel.z)) / Math.max(dist, 1)
    );
}
export const FAN_PAGE_LIMIT = 24;

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

function cardSize(doc: Document): { w: number; h: number } {
    const aspect = doc.width && doc.height ? doc.width / doc.height : DEFAULT_ASPECT;
    const h = Math.min(CELL_H, CELL_W / aspect);

    return { w: h * aspect, h };
}

/**
 * Centered near-square grid (⌈√n⌉ columns, row-major) around the island,
 * with each card letterboxed into its cell — uniform scale, never stretched.
 * Pure in (docs, island), so appended pages animate in naturally.
 */
export function fanLayout(docs: Document[], island: IslandLayout): CardPose[] {
    const n = docs.length;

    if (n === 0) return [];

    const cols = Math.ceil(Math.sqrt(n));
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
export function fanHalfExtents(documentCount: number): { halfW: number; halfH: number } {
    const n = Math.max(1, Math.min(documentCount, FAN_PAGE_LIMIT));
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);

    return { halfW: (cols * (CELL_W + GAP_X)) / 2, halfH: (rows * (CELL_H + GAP_Y)) / 2 };
}
