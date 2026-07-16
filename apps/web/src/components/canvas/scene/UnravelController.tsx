import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { IslandLayout } from '../types.js';
import { zoomToDist } from './cameraMath.js';
import { damp, registerDamper, requestFrame } from './dampers.js';
import { cam, getCanvasSnapshot, isDiving, patchCanvasSnapshot, tuning, unravelAnims, unravelRequest, unravelTarget, zoomBand } from './store.js';
import { APPROACH_DIST, enterProximity, MAX_OPEN_SWEEP, UNRAVEL_ENTER_DIST, UNRAVEL_EXIT_DIST, unravelExitRadius, viewSweep } from './unravel.js';

interface UnravelControllerProps {
    islands: IslandLayout[];
    onUnravelChange: (folderId: string | null) => void;
    onApproachFolder: (folderId: string) => void;
}

/**
 * Single writer of unravel state. Folders open only on explicit intent — an
 * island click, ?focus deep link or back-nav restore writes `unravelRequest`,
 * and this controller fans the island out once the camera has arrived on it
 * (settled inside the enter gates), preserving the fly-then-fan timing.
 * Collapse stays distance-based: zooming or panning away from an open folder
 * gathers its cards back. Also fires the approach event that pre-warms the
 * document query before the fan-out.
 */
export function UnravelController({ islands, onUnravelChange, onApproachFolder }: UnravelControllerProps) {
    const islandsRef = useRef(islands);
    islandsRef.current = islands;

    // unraveledFolderId itself lives in the store snapshot; timing state here.
    const stateRef = useRef({ approachedId: null as string | null });

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

    useFrame((_, dt) => {
        if (isDiving()) return;

        // Islands not loaded yet (fresh mount, empty cache): a seeded back-nav
        // fan must not be judged "lost" against an empty island list.
        if (islandsRef.current.length === 0) return;

        const s = stateRef.current;
        const dist = zoomToDist(cam.current.zoom);
        const distScale = tuning.unravelDistance;

        // Shared zoom-band value for the semantic-zoom LOD (glyph ↔ pile).
        // Enter on arrival (damped dist — a click-to-open flight pops the
        // pile on landing, not on click), but exit on intent (target dist):
        // gating the exit on the damped zoom makes the pile sit untouched
        // for up to ~a second while the camera's exponential tail crawls
        // across the boundary after the user has already stopped zooming.
        const gate = UNRAVEL_ENTER_DIST * distScale;
        const targetDist = zoomToDist(cam.target.zoom);
        const inBand = dist < gate && targetDist < gate ? 1 : 0;
        zoomBand.target = inBand;
        zoomBand.current = damp(zoomBand.current, inBand, 5, Math.min(dt, 0.1));

        if (Math.abs(inBand - zoomBand.current) > 1e-3) requestFrame();

        let nearest: IslandLayout | null = null;
        let nearestD = Infinity;

        for (const island of islandsRef.current) {
            const d = Math.hypot(island.position.x - cam.current.x, island.position.z - cam.current.z);

            if (d < nearestD) {
                nearestD = d;
                nearest = island;
            }
        }

        if (nearest && dist < APPROACH_DIST * distScale && nearestD < nearest.radius + 14 && s.approachedId !== nearest.id) {
            s.approachedId = nearest.id;
            onApproachFolder(nearest.id);
        }

        const unraveledId = getCanvasSnapshot().unraveledFolderId;

        const open = (id: string) => {
            unravelAnims.forEach((anim, otherId) => {
                if (otherId !== id) anim.target = 0;
            });
            unravelTarget(id, 1);
            unravelRequest.current = null;
            patchCanvasSnapshot({ unraveledFolderId: id });
            onUnravelChange(id);
            requestFrame();
        };

        const close = () => {
            unravelAnims.forEach((anim) => {
                anim.target = 0;
            });
            patchCanvasSnapshot({ unraveledFolderId: null });
            onUnravelChange(null);
            requestFrame();
        };

        const req = unravelRequest.current;

        // Drop fulfilled or stale requests (already open / island gone).
        if (req && (req.islandId === unraveledId || !islandsRef.current.some((i) => i.id === req.islandId))) {
            unravelRequest.current = null;
        }

        if (unravelRequest.current) {
            const request = unravelRequest.current;

            // Requesting a different island is fresh intent — gather the open
            // fan right away while the camera flies to the new one.
            if (unraveledId) close();

            const island = islandsRef.current.find((i) => i.id === request.islandId)!;
            const d = Math.hypot(island.position.x - cam.current.x, island.position.z - cam.current.z);
            const arrived =
                request.immediate ||
                (dist < UNRAVEL_ENTER_DIST * distScale && d < enterProximity(island.radius, dist) && viewSweep(dist) < MAX_OPEN_SWEEP);

            if (arrived) open(request.islandId);

            return;
        }

        if (!unraveledId) return;

        // Distance-based auto-collapse: the open folder gathers when the camera
        // zooms out past the exit distance, its focus wanders past the fan, or
        // a sibling becomes clearly nearer (the exit boundary can exceed
        // sibling spacing inside a cluster).
        const current = islandsRef.current.find((i) => i.id === unraveledId);
        const currentD = current ? Math.hypot(current.position.x - cam.current.x, current.position.z - cam.current.z) : Infinity;
        const competitorNearer = nearest !== null && nearest.id !== unraveledId && nearestD < currentD * 0.6;
        const lost = dist > UNRAVEL_EXIT_DIST * distScale || !current || currentD > unravelExitRadius(current, dist) || competitorNearer;

        if (lost) close();
    });

    return null;
}

/** Collapse the open fan (click-away) and cancel any pending fly-open. */
export function collapseUnravel(onUnravelChange: (folderId: string | null) => void): void {
    unravelRequest.current = null;
    const unraveledId = getCanvasSnapshot().unraveledFolderId;

    if (!unraveledId) return;

    unravelAnims.forEach((anim) => {
        anim.target = 0;
    });
    patchCanvasSnapshot({ unraveledFolderId: null });
    onUnravelChange(null);
    requestFrame();
}
