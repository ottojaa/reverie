import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { clearDiveContext, getDiveContext } from '../dive/diveState.js';
import type { CameraState, IslandLayout } from '../types.js';
import { requestFrame } from './dampers.js';
import { fitCameraTo, focusCameraOn } from './framing.js';
import { cam, unravelRequest } from './store.js';

interface InitialFramingProps {
    islands: IslandLayout[];
    focusFolderId: string | null;
    initialCamera: CameraState | null;
    returnDive: boolean;
}

/**
 * One-shot entry framing once islands arrive: reverse dive > restored
 * session > ?focus fly-in > zoom-to-fit. Always leaves current slightly
 * behind target so the rig animates a gentle entry AND fires its settle
 * callbacks afterwards.
 */
export function InitialFraming({ islands, focusFolderId, initialCamera, returnDive }: InitialFramingProps) {
    const size = useThree((s) => s.size);
    const framedRef = useRef(false);

    useEffect(() => {
        if (framedRef.current || islands.length === 0) return;

        framedRef.current = true;
        const fit = fitCameraTo(islands, size.width / size.height);

        // Back from /document: land where the dive began with only a small
        // settle-in, no reverse flight. The fan is seeded already-open by
        // resetCanvasStore (no replayed unravel) — this branch only restores
        // the camera.
        const diveCtx = getDiveContext();

        if (returnDive && diveCtx) {
            cam.target = { ...diveCtx.camBefore };
            cam.current = { ...diveCtx.camBefore, zoom: Math.min(1, diveCtx.camBefore.zoom + 0.04) };
            clearDiveContext();
            requestFrame();

            return;
        }

        clearDiveContext();

        if (initialCamera) {
            cam.target = { ...initialCamera };
            cam.current = { ...initialCamera, zoom: Math.max(0, initialCamera.zoom - 0.05) };
            requestFrame();

            return;
        }

        const focused = focusFolderId ? islands.find((i) => i.id === focusFolderId) : undefined;

        if (focused) {
            cam.current = { ...fit };
            cam.target = focusCameraOn(focused);
            unravelRequest.current = { islandId: focused.id, immediate: false };
            requestFrame();

            return;
        }

        cam.target = { ...fit };
        cam.current = { ...fit, zoom: Math.max(0, fit.zoom - 0.06) };
        requestFrame();
    }, [islands, focusFolderId, initialCamera, size]);

    return null;
}
