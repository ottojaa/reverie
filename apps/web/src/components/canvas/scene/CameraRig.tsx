import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { CameraState } from '../types.js';
import { applyPose, FOV, raycastGround, worldPerPixel, zoomTowardCursor } from './cameraMath.js';
import { clamp, damp, requestFrame } from './dampers.js';
import { cam, isDiving, islandDrag, tuning } from './store.js';

const PAN_LAMBDA = 18;
const ZOOM_LAMBDA = 14;
const INERTIA_DECAY = 3;
const WHEEL_ZOOM_FACTOR = 0.0028;
const MAX_WHEEL_ZOOM_STEP = 0.16;
const SETTLE_EPS = 1e-4;

interface CameraRigProps {
    onCameraSettled: (state: CameraState) => void;
}

function toNdc(e: { clientX: number; clientY: number }, el: HTMLElement, out: Vector2): Vector2 {
    const rect = el.getBoundingClientRect();
    out.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    return out;
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
        const drag = { pointerId: -1, lastT: 0, velX: 0, velZ: 0 };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();

            if (isDiving()) return;

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
            // islandDrag is set by the island's R3F handler, which fires first.
            if (e.button !== 0 || isDiving() || islandDrag.id !== null) return;

            applyPose(camera, cam.current);

            if (!raycastGround(camera, toNdc(e, el, ndc), grabPoint)) return;

            drag.pointerId = e.pointerId;
            drag.lastT = e.timeStamp;
            drag.velX = 0;
            drag.velZ = 0;
            cam.vel.x = 0;
            cam.vel.z = 0;
            el.setPointerCapture(e.pointerId);
        };

        const onPointerMove = (e: PointerEvent) => {
            if (e.pointerId !== drag.pointerId || islandDrag.id !== null) return;

            applyPose(camera, cam.current);

            if (!raycastGround(camera, toNdc(e, el, ndc), moveHit)) return;

            const dx = grabPoint.x - moveHit.x;
            const dz = grabPoint.z - moveHit.z;
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
        };

        const onPointerUp = (e: PointerEvent) => {
            if (e.pointerId !== drag.pointerId) return;

            drag.pointerId = -1;
            el.releasePointerCapture(e.pointerId);

            // Hand off release velocity to inertia, ignoring stale flicks.
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
