import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group, Mesh, MeshBasicMaterial } from 'three';
import type { IslandLayout } from '../types.js';
import { zoomToDist } from './cameraMath.js';
import { cam, getCanvasSnapshot, tuning, unravelSuppression } from './store.js';
import { enterProximity, EXIT_SLACK, MAX_OPEN_SWEEP, UNRAVEL_ENTER_DIST, UNRAVEL_EXIT_DIST, viewSweep } from './unravel.js';

/**
 * Debug overlay for the semantic-zoom gates. Draws the exact conditions the
 * controller evaluates each frame:
 *
 * - A reticle at the camera's focus (the screen-center ground point — this is
 *   the point that must land inside a folder's circle to open it):
 *   green = would open · orange = blocked by sweep gate · gray = zoomed out
 *   past the enter distance.
 * - Per folder, the enter-proximity circle (grows with camera distance) in
 *   the same colors, red when the folder is suppressed (click-away/back-nav);
 *   the currently open folder shows its exit boundary instead (dashed-faint).
 */

const COLOR_OPEN = '#22c55e';
const COLOR_SWEEP = '#f59e0b';
const COLOR_FAR = '#64748b';
const COLOR_SUPPRESSED = '#ef4444';
const COLOR_EXIT = '#38bdf8';

export function UnravelDebug({ islands }: { islands: IslandLayout[] }) {
    const reticleRef = useRef<Group>(null);
    const reticleMatRef = useRef<MeshBasicMaterial>(null);
    const ringsRef = useRef(new Map<string, Mesh>());

    useFrame(() => {
        const dist = zoomToDist(cam.current.zoom);
        const distScale = tuning.unravelDistance;
        const zoomOk = dist < UNRAVEL_ENTER_DIST * distScale;
        const sweeping = viewSweep(dist) >= MAX_OPEN_SWEEP;
        const unraveledId = getCanvasSnapshot().unraveledFolderId;

        let nearest: IslandLayout | null = null;
        let nearestD = Infinity;

        for (const island of islands) {
            const d = Math.hypot(island.position.x - cam.current.x, island.position.z - cam.current.z);

            if (d < nearestD) {
                nearestD = d;
                nearest = island;
            }
        }

        for (const island of islands) {
            const mesh = ringsRef.current.get(island.id);

            if (!mesh) continue;

            const material = mesh.material as MeshBasicMaterial;
            const isOpen = island.id === unraveledId;
            const prox = enterProximity(island.radius, dist);
            // The open folder's ring shows what keeps it open (exit boundary);
            // everything else shows what would open it (enter proximity).
            mesh.scale.setScalar(isOpen ? island.radius + EXIT_SLACK : prox);
            mesh.position.set(island.position.x, 0.18, island.position.z);

            const isNearest = nearest?.id === island.id;
            const centered = isNearest && nearestD < prox;

            if (isOpen) material.color.set(COLOR_EXIT);
            else if (unravelSuppression.has(island.id)) material.color.set(COLOR_SUPPRESSED);
            else if (centered && zoomOk) material.color.set(sweeping ? COLOR_SWEEP : COLOR_OPEN);
            else material.color.set(COLOR_FAR);

            material.opacity = isNearest || isOpen ? 0.9 : 0.3;
        }

        const reticle = reticleRef.current;

        if (reticle) {
            reticle.position.set(cam.current.x, 0.2, cam.current.z);
            // Constant apparent size: ~2% of the camera distance.
            reticle.scale.setScalar(Math.max(0.4, dist * 0.02));
        }

        const reticleMat = reticleMatRef.current;

        if (reticleMat) {
            const wouldOpen = nearest !== null && zoomOk && nearestD < enterProximity(nearest.radius, dist);

            if (!zoomOk) reticleMat.color.set(COLOR_FAR);
            else if (wouldOpen) reticleMat.color.set(sweeping ? COLOR_SWEEP : COLOR_OPEN);
            else reticleMat.color.set('#e2e8f0');
        }
    });

    return (
        <>
            <group ref={reticleRef}>
                <mesh rotation-x={-Math.PI / 2} renderOrder={520}>
                    <ringGeometry args={[0.72, 1, 48]} />
                    <meshBasicMaterial ref={reticleMatRef} transparent opacity={0.95} depthWrite={false} depthTest={false} />
                </mesh>
                <mesh rotation-x={-Math.PI / 2} renderOrder={520}>
                    <circleGeometry args={[0.14, 24]} />
                    <meshBasicMaterial color="#e2e8f0" transparent opacity={0.95} depthWrite={false} depthTest={false} />
                </mesh>
            </group>
            {islands.map((island) => (
                <mesh
                    key={island.id}
                    ref={(mesh) => {
                        if (mesh) ringsRef.current.set(island.id, mesh);
                        else ringsRef.current.delete(island.id);
                    }}
                    rotation-x={-Math.PI / 2}
                    renderOrder={510}
                >
                    {/* Unit ring scaled per frame to the live threshold radius. */}
                    <ringGeometry args={[0.97, 1, 64]} />
                    <meshBasicMaterial transparent depthWrite={false} depthTest={false} />
                </mesh>
            ))}
        </>
    );
}
