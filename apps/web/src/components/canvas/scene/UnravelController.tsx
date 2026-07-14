import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { IslandLayout } from '../types.js';
import { zoomToDist } from './cameraMath.js';
import { damp, registerDamper, requestFrame } from './dampers.js';
import { cam, getCanvasSnapshot, hover, isDiving, patchCanvasSnapshot, tuning, unravelAnims, unravelSuppression, unravelTarget } from './store.js';
import { APPROACH_DIST, HOVER_LINGER_MS, HOVER_UNRAVEL_MAX_DIST, SWITCH_DEBOUNCE_MS, UNRAVEL_ENTER_DIST, UNRAVEL_EXIT_DIST } from './unravel.js';

// Entering by zoom requires being nearly centered on the island — a generous
// enter radius made the overview fit of small libraries auto-unravel the
// nearest folder. The fan extends past the plate, so EXIT stays generous.
const EXIT_SLACK = 14;

function enterProximity(radius: number): number {
    return radius * 0.75 + 0.5;
}

interface UnravelControllerProps {
    islands: IslandLayout[];
    onUnravelChange: (folderId: string | null) => void;
    onApproachFolder: (folderId: string) => void;
}

/**
 * Semantic-zoom brain: each frame it scores the island nearest the camera
 * focus and flips per-folder unravel targets with hysteresis (enter < exit)
 * plus a switch debounce. Hover is an alternative entry (trackpad users
 * shouldn't have to zoom); a hovered fan keeps its folder open with a short
 * linger so pointer gaps between cards don't collapse it. Also fires the
 * approach event that pre-warms the document query before the fan-out.
 */
export function UnravelController({ islands, onUnravelChange, onApproachFolder }: UnravelControllerProps) {
    const islandsRef = useRef(islands);
    islandsRef.current = islands;

    // unraveledFolderId itself lives in the store snapshot; timing state here.
    const stateRef = useRef({
        lastSwitchAt: 0,
        approachedId: null as string | null,
        lastHoverAt: 0,
    });

    // The eased per-folder unravel values chase their targets here.
    useEffect(
        () =>
            registerDamper((dt) => {
                let active = false;

                unravelAnims.forEach((anim, id) => {
                    if (Math.abs(anim.target - anim.current) < 1e-3) {
                        anim.current = anim.target;

                        if (anim.current === 0) unravelAnims.delete(id);

                        return;
                    }

                    // Collapse faster than the fan-out — the retract reads better brisk.
                    anim.current = damp(anim.current, anim.target, anim.target === 0 ? 12 : 8, dt);
                    active = true;
                });

                return active;
            }),
        [],
    );

    useFrame(() => {
        if (isDiving()) return;

        const s = stateRef.current;
        const dist = zoomToDist(cam.current.zoom);
        const distScale = tuning.unravelDistance;
        const now = performance.now();

        let nearest: IslandLayout | null = null;
        let nearestD = Infinity;

        for (const island of islandsRef.current) {
            const d = Math.hypot(island.position.x - cam.current.x, island.position.z - cam.current.z);

            if (d < nearestD) {
                nearestD = d;
                nearest = island;
            }
        }

        if (nearest && dist < APPROACH_DIST * distScale && nearestD < nearest.radius + 12 && s.approachedId !== nearest.id) {
            s.approachedId = nearest.id;
            onApproachFolder(nearest.id);
        }

        const unraveledId = getCanvasSnapshot().unraveledFolderId;

        // Hovering a fanned card counts as hovering its folder — otherwise
        // moving the pointer from the island onto a card would collapse it.
        const hoverId = hover.islandId ?? (hover.docId ? unraveledId : null);

        if (hoverId) s.lastHoverAt = now;

        const hoverLingering = now - s.lastHoverAt < HOVER_LINGER_MS;

        // The pointer left a suppressed island — arm it again.
        if (unravelSuppression.id && hover.islandId !== unravelSuppression.id && !hoverLingering) {
            unravelSuppression.id = null;
        }

        const zoomCandidate = nearest && dist < UNRAVEL_ENTER_DIST * distScale && nearestD < enterProximity(nearest.radius) ? nearest.id : null;
        const hoverCandidate = tuning.hoverUnravel && dist < HOVER_UNRAVEL_MAX_DIST * distScale ? hoverId : null;
        let candidate = hoverCandidate ?? zoomCandidate;

        if (candidate && candidate === unravelSuppression.id) candidate = null;

        let next = unraveledId;

        if (unraveledId === null) {
            next = candidate;
        } else {
            const current = islandsRef.current.find((i) => i.id === unraveledId);
            const currentD = current ? Math.hypot(current.position.x - cam.current.x, current.position.z - cam.current.z) : Infinity;
            // The exit slack can exceed sibling spacing inside a cluster, so an
            // island must also yield when a competitor is clearly nearer —
            // otherwise a neighbour's fan sticks open while hovering this one.
            const competitorNearer = nearest !== null && nearest.id !== unraveledId && nearestD < currentD * 0.6;
            const zoomLost = dist > UNRAVEL_EXIT_DIST * distScale || currentD > (current?.radius ?? 0) + EXIT_SLACK || competitorNearer;
            // A hover-opened folder stays open while hovered (or lingering).
            const hoverHeld = tuning.hoverUnravel && hoverLingering && (hoverId === null || hoverId === unraveledId);
            const lost = (zoomLost && !hoverHeld) || (hoverId !== null && hoverId !== unraveledId && candidate !== null);

            if (lost) next = candidate;
        }

        if (next === unraveledId) return;

        if (now - s.lastSwitchAt < SWITCH_DEBOUNCE_MS) {
            // Blocked by debounce — keep frames coming so we retry shortly.
            requestFrame();

            return;
        }

        s.lastSwitchAt = now;
        unravelAnims.forEach((anim, id) => {
            if (id !== next) anim.target = 0;
        });

        if (next) unravelTarget(next, 1);

        patchCanvasSnapshot({ unraveledFolderId: next });
        onUnravelChange(next);
        requestFrame();
    });

    return null;
}

/** Collapse the open fan (click-away) and suppress instant re-unravel. */
export function collapseUnravel(onUnravelChange: (folderId: string | null) => void): void {
    const unraveledId = getCanvasSnapshot().unraveledFolderId;

    if (!unraveledId) return;

    unravelSuppression.id = unraveledId;
    unravelAnims.forEach((anim) => {
        anim.target = 0;
    });
    patchCanvasSnapshot({ unraveledFolderId: null });
    onUnravelChange(null);
    requestFrame();
}
