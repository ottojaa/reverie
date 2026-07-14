import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { CameraState } from '../types.js';
import { clamp, ease, lerp } from './dampers.js';

/**
 * 2.5D camera model: the camera hovers above the ground plane (y=0) at a
 * distance derived from a zoom scalar, tilted slightly from vertical for
 * depth. All pose math lives here so the rig, the dive transition, and
 * zoom-toward-cursor share one source of truth.
 */

export const FOV = 50;
export const D_MIN = 5;
export const D_MAX = 240;
const TILT_FAR = (22 * Math.PI) / 180;
const TILT_NEAR = (14 * Math.PI) / 180;

/** Exponential distance mapping so wheel steps feel uniform at every scale. */
export function zoomToDist(zoom: number): number {
    return D_MAX * Math.pow(D_MIN / D_MAX, clamp(zoom, 0, 1));
}

export function distToZoom(dist: number): number {
    return clamp(Math.log(dist / D_MAX) / Math.log(D_MIN / D_MAX), 0, 1);
}

function tiltAt(zoom: number): number {
    return lerp(TILT_FAR, TILT_NEAR, ease(zoom));
}

/** Position + orient a camera for the given state. Mutates and returns it. */
export function applyPose(camera: PerspectiveCamera, state: CameraState): PerspectiveCamera {
    const dist = zoomToDist(state.zoom);
    const tilt = tiltAt(state.zoom);

    camera.position.set(state.x, Math.cos(tilt) * dist, state.z + Math.sin(tilt) * dist);
    camera.lookAt(state.x, 0, state.z);
    camera.updateMatrixWorld();

    return camera;
}

/** World units per screen pixel at the camera's focus depth. */
export function worldPerPixel(zoom: number, viewportHeightPx: number): number {
    return (2 * zoomToDist(zoom) * Math.tan(((FOV / 2) * Math.PI) / 180)) / viewportHeightPx;
}

const raycaster = new Raycaster();
export const groundPlane = new Plane(new Vector3(0, 1, 0), 0);

/** Intersect a ray through NDC coords with the ground plane. */
export function raycastGround(camera: PerspectiveCamera, ndc: Vector2, out: Vector3): Vector3 | null {
    raycaster.setFromCamera(ndc, camera);

    return raycaster.ray.intersectPlane(groundPlane, out);
}

const scratchCam = new PerspectiveCamera(FOV, 1, 0.1, 2000);
const hitBefore = new Vector3();
const hitAfter = new Vector3();

/**
 * Apply a zoom delta while keeping the world point under the cursor fixed.
 * Exact under tilt: raycast the cursor before and after the zoom against a
 * scratch camera at the *target* pose (not the eased current one), so rapid
 * wheel ticks compose correctly.
 */
export function zoomTowardCursor(target: CameraState, ndc: Vector2, aspect: number, deltaZoom: number): void {
    scratchCam.fov = FOV;
    scratchCam.aspect = aspect;
    scratchCam.updateProjectionMatrix();

    applyPose(scratchCam, target);
    const before = raycastGround(scratchCam, ndc, hitBefore);

    target.zoom = clamp(target.zoom + deltaZoom, 0, 1);

    applyPose(scratchCam, target);
    const after = raycastGround(scratchCam, ndc, hitAfter);

    if (!before || !after) return;

    target.x += before.x - after.x;
    target.z += before.z - after.z;
}
