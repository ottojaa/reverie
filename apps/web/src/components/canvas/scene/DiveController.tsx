import { useFrame, useThree } from '@react-three/fiber';
import type { Document } from '@reverie/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { DIVE_MS, getDiveContext, setDiveContext } from '../dive/diveState.js';
import { computeDestRect } from '../dive/diveTransition.js';
import { distToZoom } from './cameraMath.js';
import { cardGeometry } from './cardMaterial.js';
import { ease, lerp, requestFrame } from './dampers.js';
import { setRawColor } from './glColor.js';
import { cam, getCanvasSnapshot, patchCanvasSnapshot } from './store.js';
import type { CanvasTheme } from './theme.js';
import type { CardPose } from './unravel.js';

/**
 * Camera-space depths at the flight's end. The diving card's pose is solved so
 * its projection equals destRect at ANY depth, and both meshes render with
 * depthTest off under painter ordering (card 600 > quad 500) — so these values
 * never affect pixel size. The quad still sits genuinely behind the card in
 * case depth testing is ever re-enabled; keep card < quad.
 */
export const HANDOFF_CARD_DEPTH = 8;
const FADE_QUAD_DEPTH = 9;

let pendingDive: { doc: Document; pose: CardPose; folderId: string } | null = null;

/** Called by a card on click; picked up by DiveController on the next frame. */
export function requestDive(doc: Document, pose: CardPose, folderId: string): void {
    pendingDive = { doc, pose, folderId };
    requestFrame();
}

interface DiveControllerProps {
    theme: CanvasTheme;
    /** Fired once when the flight lands — the DOM side mounts the overlay and navigates. */
    onDiveHandoff: (doc: Document) => void;
}

/**
 * Drives the dive flight: eases the camera onto the clicked card while a
 * camera-space quad fades the rest of the scene to the background color.
 * The diving card itself blends toward its analytic end pose in
 * DocumentCard3D; at p=1 this hands off to the DOM overlay.
 */
export function DiveController({ theme, onDiveHandoff }: DiveControllerProps) {
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const fadeRef = useRef<Mesh>(null);
    const handoffFiredRef = useRef(false);
    const scratch = useMemo(() => new Vector3(), []);

    const fadeMaterial = useMemo(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }), []);

    useEffect(() => () => fadeMaterial.dispose(), [fadeMaterial]);

    useFrame(() => {
        const fade = fadeRef.current;

        if (pendingDive && getCanvasSnapshot().divePhase === 'idle') {
            const { doc, pose, folderId } = pendingDive;
            pendingDive = null;
            cam.vel.x = 0;
            cam.vel.z = 0;

            // End the dolly where the card's unblended projection already fills
            // the destination rect — flying to max zoom regardless makes large
            // images overshoot and visibly shrink back during the blend.
            const destRect = computeDestRect(doc);
            const halfFovTan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
            const distEnd = (pose.h * window.innerHeight) / (destRect.h * 2 * halfFovTan);

            setDiveContext({
                doc,
                folderId,
                cardX: pose.fanned.x,
                cardZ: pose.fanned.z,
                endZoom: distToZoom(distEnd),
                camBefore: { ...cam.target },
                destRect,
                startedAt: performance.now(),
            });
            patchCanvasSnapshot({ divePhase: 'flying' });
            handoffFiredRef.current = false;
        }

        const ctx = getDiveContext();
        const phase = getCanvasSnapshot().divePhase;

        if (!ctx || phase === 'idle') {
            if (fade) fade.visible = false;

            return;
        }

        const p = Math.min(1, (performance.now() - ctx.startedAt) / DIVE_MS);

        if (phase === 'flying') {
            const e = ease(p);
            cam.current.x = cam.target.x = lerp(ctx.camBefore.x, ctx.cardX, e);
            cam.current.z = cam.target.z = lerp(ctx.camBefore.z, ctx.cardZ, e);
            cam.current.zoom = cam.target.zoom = lerp(ctx.camBefore.zoom, ctx.endZoom, e);
        }

        // Camera-space fade quad just behind the diving card's handoff depth.
        if (fade) {
            const depth = FADE_QUAD_DEPTH;
            const halfH = depth * Math.tan(((camera.fov / 2) * Math.PI) / 180);
            fade.visible = true;
            fade.position.copy(camera.localToWorld(scratch.set(0, 0, -depth)));
            fade.quaternion.copy(camera.quaternion);
            fade.scale.set(halfH * 2 * camera.aspect * 1.1, halfH * 2 * 1.1, 1);
            setRawColor(fadeMaterial.color, theme.background);
            fadeMaterial.opacity = ease(Math.min(1, p * 1.4));
        }

        if (p >= 1 && !handoffFiredRef.current && phase === 'flying') {
            handoffFiredRef.current = true;
            patchCanvasSnapshot({ divePhase: 'handoff' });
            onDiveHandoff(ctx.doc);
        }

        if (p < 1) requestFrame();
    });

    return <mesh ref={fadeRef} geometry={cardGeometry} material={fadeMaterial} visible={false} renderOrder={500} frustumCulled={false} />;
}
