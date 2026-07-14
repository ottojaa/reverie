import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { CameraState, IslandLayout } from '../types.js';
import { applyPose, distToZoom, FOV, raycastGround } from './cameraMath.js';
import { tuning } from './store.js';
import { fanHalfExtents, UNRAVEL_ENTER_DIST } from './unravel.js';

const HALF_FOV_TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const FIT_MARGIN = 1.2;

/** Camera state that frames every island (approximate under tilt; the fit margin absorbs it). */
export function fitCameraTo(islands: IslandLayout[], aspect: number): CameraState {
    if (islands.length === 0) return { x: 0, z: 0, zoom: 0.25 };

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const island of islands) {
        const pad = island.radius + 4;
        minX = Math.min(minX, island.position.x - pad);
        maxX = Math.max(maxX, island.position.x + pad);
        minZ = Math.min(minZ, island.position.z - pad);
        maxZ = Math.max(maxZ, island.position.z + pad);
    }

    const halfW = Math.max(8, (maxX - minX) / 2);
    const halfH = Math.max(8, (maxZ - minZ) / 2);
    const dist = Math.max(halfH / HALF_FOV_TAN, halfW / (HALF_FOV_TAN * aspect), 10) * FIT_MARGIN;

    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, zoom: distToZoom(dist) };
}

/**
 * Camera state hovering over one island, framed so the folder's FAN will fit
 * once it unravels — but always inside the unravel-enter threshold, since
 * focusing a folder is an intent to open it.
 */
export function focusCameraOn(island: IslandLayout): CameraState {
    const { halfW, halfH } = fanHalfExtents(island.documentCount);
    const byPlate = island.radius / (0.6 * HALF_FOV_TAN);
    // Conservative aspect (1.3) for the width fit; labels pad the height.
    const byFan = Math.max((halfW + 1.5) / (HALF_FOV_TAN * 1.3), (halfH + 2) / HALF_FOV_TAN);
    const dist = Math.min(UNRAVEL_ENTER_DIST * tuning.unravelDistance - 2, Math.max(6, byPlate, byFan));

    return { x: island.position.x, z: island.position.z, zoom: distToZoom(dist) };
}

const scratchCam = new PerspectiveCamera(FOV, 1, 0.1, 2000);
const corner = new Vector2();
const hit = new Vector3();

/**
 * Islands whose footprint intersects the camera's ground-projected view
 * rect. Drives the visibility-based preview fetching, so it errs generous
 * (margin) rather than exact.
 */
export function visibleIslandIds(state: CameraState, islands: IslandLayout[], aspect: number, margin = 6): string[] {
    scratchCam.aspect = aspect;
    scratchCam.updateProjectionMatrix();
    applyPose(scratchCam, state);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const [nx, ny] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
    ] as const) {
        // Near the horizon a corner ray can miss the plane — fall back to a
        // generous cap tied to the camera distance instead.
        const point = raycastGround(scratchCam, corner.set(nx, ny), hit);

        if (!point) continue;

        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
    }

    if (!Number.isFinite(minX)) return [];

    return islands
        .filter(
            (island) =>
                island.position.x + island.radius + margin >= minX &&
                island.position.x - island.radius - margin <= maxX &&
                island.position.z + island.radius + margin >= minZ &&
                island.position.z - island.radius - margin <= maxZ,
        )
        .map((island) => island.id);
}
