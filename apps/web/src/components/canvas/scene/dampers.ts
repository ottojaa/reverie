/**
 * Animation primitives for the canvas scene (ported from lunamux's
 * lerp-toward-target system: every animation is an eased value chasing a
 * target, and "settled" is a crisp predicate that lets frameloop="demand"
 * stop rendering entirely when the scene is idle).
 */

/** Smoothstep easing — `p·p·(3−2p)`. */
export function ease(p: number): number {
    const t = Math.min(1, Math.max(0, p));

    return t * t * (3 - 2 * t);
}

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

/** Ease-out with a small (~10%) overshoot past 1 before settling — "pop". */
export function easeOutBack(p: number): number {
    const t = Math.min(1, Math.max(0, p)) - 1;

    return 1 + BACK_C3 * t * t * t + BACK_C1 * t * t;
}

/** Frame-rate-corrected exponential damping toward a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

/**
 * A registered per-frame updater. Returns true while still animating;
 * the frame driver keeps invalidating until every damper reports false.
 */
export type DamperFn = (dt: number) => boolean;

const dampers = new Set<DamperFn>();

export function registerDamper(fn: DamperFn): () => void {
    dampers.add(fn);

    return () => dampers.delete(fn);
}

let invalidate: (() => void) | null = null;

/** Wired to R3F's invalidate() by the frame driver (frameloop="demand"). */
export function setInvalidator(fn: (() => void) | null): void {
    invalidate = fn;
}

/** Nudge the render loop awake — call from input handlers, texture arrivals, etc. */
export function requestFrame(): void {
    invalidate?.();
}

/** Run all dampers for this frame; true if any is still animating. */
export function updateDampers(dt: number): boolean {
    let active = false;

    for (const fn of dampers) {
        try {
            active = fn(dt) || active;
        } catch (err) {
            // One bad frame must never kill the loop (hard-won lunamux lesson).
            console.error('Canvas damper failed: ', err);
        }
    }

    return active;
}
