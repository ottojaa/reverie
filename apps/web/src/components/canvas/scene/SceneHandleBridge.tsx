import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { CanvasSceneHandle, IslandLayout } from '../types.js';
import { clamp, requestFrame } from './dampers.js';
import { fitCameraTo } from './framing.js';
import { cam, unravelRequest } from './store.js';

interface SceneHandleBridgeProps {
    handleRef: React.RefObject<CanvasSceneHandle | null> | undefined;
    islands: IslandLayout[];
}

/** Exposes the imperative zoom handle (DOM overlay buttons) to CanvasPage. */
export function SceneHandleBridge({ handleRef, islands }: SceneHandleBridgeProps) {
    const size = useThree((s) => s.size);
    const islandsRef = useRef(islands);
    islandsRef.current = islands;
    const sizeRef = useRef(size);
    sizeRef.current = size;

    useEffect(() => {
        if (!handleRef) return;

        handleRef.current = {
            zoomBy: (delta) => {
                cam.target.zoom = clamp(cam.target.zoom + delta, 0, 1);
                requestFrame();
            },
            zoomToFit: () => {
                // Flying to the overview contradicts a pending click-to-open.
                unravelRequest.current = null;
                cam.target = fitCameraTo(islandsRef.current, sizeRef.current.width / sizeRef.current.height);
                requestFrame();
            },
        };

        return () => {
            handleRef.current = null;
        };
    }, [handleRef]);

    return null;
}
