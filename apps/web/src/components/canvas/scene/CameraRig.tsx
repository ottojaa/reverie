import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { CameraState } from '../types.js';
import { applyPose, D_MAX, D_MIN, FOV, PAN_LAMBDA, raycastGround, worldPerPixel, zoomTowardCursor } from './cameraMath.js';
import { clamp, damp, requestFrame } from './dampers.js';
import { cam, isDiving, islandDrag, lastPointerDown, tuning, unravelRequest } from './store.js';

const ZOOM_LAMBDA = 14;
const INERTIA_DECAY = 3;
const WHEEL_ZOOM_FACTOR = 0.0028;
const MAX_WHEEL_ZOOM_STEP = 0.16;
const SETTLE_EPS = 1e-4;
// Pinch: zoom is log-distance, so ln(fingerDistRatio)/ln(D_MAX/D_MIN) makes
// on-screen content track the fingers exactly 1:1 (no zoomSpeed multiplier —
// direct manipulation should feel physical; the wheel keeps its multiplier).
const ZOOM_LOG_RANGE = Math.log(D_MAX / D_MIN);
const MAX_PINCH_ZOOM_STEP = 0.08;
// Below this finger separation the distance ratio is all noise.
const MIN_PINCH_DIST_PX = 24;

interface CameraRigProps {
    onCameraSettled: (state: CameraState) => void;
}

function toNdc(e: { clientX: number; clientY: number }, el: HTMLElement, out: Vector2): Vector2 {
    const rect = el.getBoundingClientRect();
    out.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    return out;
}

/** setPointerCapture throws for already-released (or synthetic) pointers — never fatal. */
function capturePointer(el: HTMLElement, pointerId: number): void {
    try {
        el.setPointerCapture(pointerId);
    } catch {
        // Losing capture only degrades edge-of-canvas drags; carry on.
    }
}

/**
 * Custom 2.5D controller with Figma-style input semantics:
 * plain wheel = pan, ctrl/cmd+wheel (incl. trackpad pinch) = zoom toward
 * cursor, drag = plane-anchored pan with inertia on release.
 */
export function CameraRig({ onCameraSettled }: CameraRigProps) {
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const gl = useThree((s) => s.gl);
    const size = useThree((s) => s.size);
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const wasMovingRef = useRef(false);

    // Store reset happens in CanvasScene's render body (once per mount, before
    // any child effect) — resetting here raced InitialFraming under StrictMode
    // effect replays and could clobber the entry framing.
    useLayoutEffect(() => {
        camera.fov = FOV;
        camera.near = 0.1;
        camera.far = 2000;
        camera.updateProjectionMatrix();
        applyPose(camera, cam.current);
    }, [camera]);

    useEffect(() => {
        const el = gl.domElement;
        const ndc = new Vector2();
        const grabPoint = new Vector3();
        const moveHit = new Vector3();
        const pointers = new Map<number, { x: number; y: number }>();
        const drag = { lastT: 0, velX: 0, velZ: 0 };
        const pinch = { lastDist: 0 };

        // Anchor the gesture on the ground point under (clientX, clientY).
        const anchorAt = (clientX: number, clientY: number): boolean => {
            applyPose(camera, cam.current);

            return raycastGround(camera, toNdc({ clientX, clientY }, el, ndc), grabPoint) !== null;
        };

        const midpoint = (): { clientX: number; clientY: number; dist: number } | null => {
            const [a, b] = [...pointers.values()];

            if (!a || !b) return null;

            return { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();

            if (isDiving()) return;

            // Manual camera input abandons a pending click-to-open flight —
            // otherwise the folder would ghost-open later on arrival.
            unravelRequest.current = null;

            if (e.ctrlKey || e.metaKey) {
                const step = clamp(-e.deltaY * WHEEL_ZOOM_FACTOR * tuning.zoomSpeed, -MAX_WHEEL_ZOOM_STEP, MAX_WHEEL_ZOOM_STEP);
                zoomTowardCursor(cam.target, toNdc(e, el, ndc), sizeRef.current.width / sizeRef.current.height, step);
            } else {
                const wpp = worldPerPixel(cam.target.zoom, sizeRef.current.height) * tuning.panSpeed;
                cam.target.x += e.deltaX * wpp;
                cam.target.z += e.deltaY * wpp;
            }

            cam.vel.x = 0;
            cam.vel.z = 0;
            requestFrame();
        };

        const onPointerDown = (e: PointerEvent) => {
            lastPointerDown.x = e.clientX;
            lastPointerDown.y = e.clientY;

            // islandDrag guards against panning under an island drag-nudge;
            // the move-time check below is the one that matters (native
            // canvas listeners fire before the island's R3F handler).
            if (e.button !== 0 || isDiving() || islandDrag.id !== null) return;

            // A 3rd+ finger joins no gesture — two is all pan/pinch needs.
            if (pointers.size >= 2) return;

            if (pointers.size === 0 && !anchorAt(e.clientX, e.clientY)) return;

            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            capturePointer(el, e.pointerId);
            cam.vel.x = 0;
            cam.vel.z = 0;
            drag.velX = 0;
            drag.velZ = 0;
            drag.lastT = e.timeStamp;

            if (pointers.size < 2) return;

            // 1 → 2 fingers: promote the drag to a pinch — re-anchor at the
            // midpoint (never mid-gesture, so nothing jumps).
            const m = midpoint();

            if (!m) return;

            pinch.lastDist = m.dist;
            anchorAt(m.clientX, m.clientY);
        };

        const onPointerMove = (e: PointerEvent) => {
            const p = pointers.get(e.pointerId);

            if (!p || islandDrag.id !== null) return;

            p.x = e.clientX;
            p.y = e.clientY;

            if (pointers.size === 1) {
                applyPose(camera, cam.current);

                if (!raycastGround(camera, toNdc(e, el, ndc), moveHit)) return;

                const dx = grabPoint.x - moveHit.x;
                const dz = grabPoint.z - moveHit.z;
                // A real drag abandons a pending click-to-open flight (see onWheel).
                unravelRequest.current = null;
                // Direct 1:1 during drag — write target AND current so damping adds no lag.
                cam.target.x += dx;
                cam.target.z += dz;
                cam.current.x += dx;
                cam.current.z += dz;

                const dt = Math.max(1, e.timeStamp - drag.lastT) / 1000;
                drag.velX = dx / dt;
                drag.velZ = dz / dt;
                drag.lastT = e.timeStamp;
                requestFrame();

                return;
            }

            // Pinch: zoom from the finger-distance ratio toward the midpoint…
            const m = midpoint();

            if (!m) return;

            unravelRequest.current = null;

            if (m.dist > MIN_PINCH_DIST_PX && pinch.lastDist > MIN_PINCH_DIST_PX) {
                const step = clamp(Math.log(m.dist / pinch.lastDist) / ZOOM_LOG_RANGE, -MAX_PINCH_ZOOM_STEP, MAX_PINCH_ZOOM_STEP);
                zoomTowardCursor(cam.target, toNdc({ clientX: m.clientX, clientY: m.clientY }, el, ndc), sizeRef.current.width / sizeRef.current.height, step);
            }

            pinch.lastDist = m.dist;
            // …then keep the anchored ground point under the moving midpoint.
            // Snap current to target first — no damper lag mid-gesture, same
            // rationale as the single-pointer drag.
            cam.current.x = cam.target.x;
            cam.current.z = cam.target.z;
            cam.current.zoom = cam.target.zoom;
            applyPose(camera, cam.current);

            if (raycastGround(camera, toNdc({ clientX: m.clientX, clientY: m.clientY }, el, ndc), moveHit)) {
                const dx = grabPoint.x - moveHit.x;
                const dz = grabPoint.z - moveHit.z;
                cam.target.x += dx;
                cam.target.z += dz;
                cam.current.x += dx;
                cam.current.z += dz;
            }

            // Pinch never hands off inertia — flicks come from one-finger pans only.
            drag.velX = 0;
            drag.velZ = 0;
            drag.lastT = e.timeStamp;
            requestFrame();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!pointers.delete(e.pointerId)) return;

            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

            if (pointers.size === 1) {
                // 2 → 1 fingers: back to single-finger pan — re-anchor under
                // the survivor, with no velocity carried over from the pinch.
                const [rest] = [...pointers.values()];

                if (rest) anchorAt(rest.x, rest.y);

                drag.velX = 0;
                drag.velZ = 0;
                drag.lastT = e.timeStamp;

                return;
            }

            if (pointers.size > 0) return;

            // Last pointer up: hand release velocity to inertia, ignoring
            // stale flicks. Safe after a pinch — velocities were zeroed on
            // every pinch move and on the 2→1 transition.
            if (e.timeStamp - drag.lastT < 80) {
                cam.vel.x = drag.velX;
                cam.vel.z = drag.velZ;
                requestFrame();
            }
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);

        return () => {
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', onPointerUp);
            el.removeEventListener('pointercancel', onPointerUp);
        };
    }, [gl, camera]);

    useFrame((_, dt) => {
        const step = Math.min(dt, 0.1);
        const speedFloor = 0.02 * worldPerPixel(cam.current.zoom, sizeRef.current.height) * sizeRef.current.height;

        cam.target.x += cam.vel.x * step;
        cam.target.z += cam.vel.z * step;
        const decay = Math.exp(-INERTIA_DECAY * tuning.friction * step);
        cam.vel.x = Math.abs(cam.vel.x * decay) < speedFloor ? 0 : cam.vel.x * decay;
        cam.vel.z = Math.abs(cam.vel.z * decay) < speedFloor ? 0 : cam.vel.z * decay;

        cam.current.x = damp(cam.current.x, cam.target.x, PAN_LAMBDA, step);
        cam.current.z = damp(cam.current.z, cam.target.z, PAN_LAMBDA, step);
        cam.current.zoom = damp(cam.current.zoom, cam.target.zoom, ZOOM_LAMBDA, step);

        const moving =
            Math.abs(cam.target.x - cam.current.x) > SETTLE_EPS ||
            Math.abs(cam.target.z - cam.current.z) > SETTLE_EPS ||
            Math.abs(cam.target.zoom - cam.current.zoom) > SETTLE_EPS ||
            cam.vel.x !== 0 ||
            cam.vel.z !== 0;

        if (!moving && wasMovingRef.current && !isDiving()) {
            cam.current.x = cam.target.x;
            cam.current.z = cam.target.z;
            cam.current.zoom = cam.target.zoom;
            onCameraSettled({ ...cam.current });
        }

        wasMovingRef.current = moving;
        applyPose(camera, cam.current);

        if (moving) requestFrame();
    });

    return null;
}
