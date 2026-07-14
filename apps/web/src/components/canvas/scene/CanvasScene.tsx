import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { clearDiveContext, getDiveContext } from '../dive/diveState.js';
import type { CameraState, CanvasSceneHandle, CanvasSceneProps, IslandLayout } from '../types.js';
import { CameraRig } from './CameraRig.js';
import { CollectionLabels } from './CollectionLabels.js';
import { clamp, requestFrame, setInvalidator, updateDampers } from './dampers.js';
import { DiveController } from './DiveController.js';
import { FolderIsland } from './FolderIsland.js';
import { fitCameraTo, focusCameraOn, visibleIslandIds } from './framing.js';
import { GroundGrid } from './GroundGrid.js';
import { IslandStack } from './IslandStack.js';
import { disposeEmojiTextures } from './labelAssets.js';
import { cam, lastPointerDown, resetCanvasStore, tuning, unravelSuppression } from './store.js';
import { disposeAllTextures, setMaxAnisotropy } from './textureCache.js';
import { useCanvasTheme } from './theme.js';
import { collapseUnravel, UnravelController } from './UnravelController.js';
import { UnraveledCards } from './UnraveledCards.js';

/** Wires the damper registry into R3F's demand frameloop. */
function FrameDriver() {
    const invalidate = useThree((s) => s.invalidate);

    useEffect(() => {
        setInvalidator(() => invalidate());

        return () => setInvalidator(null);
    }, [invalidate]);

    useFrame((_, dt) => {
        if (updateDampers(Math.min(dt, 0.1))) requestFrame();
    });

    return null;
}

function ContextLossGuard() {
    const gl = useThree((s) => s.gl);

    useEffect(() => {
        const el = gl.domElement;
        const onLost = (e: Event) => e.preventDefault();
        const onRestored = () => requestFrame();

        el.addEventListener('webglcontextlost', onLost);
        el.addEventListener('webglcontextrestored', onRestored);

        return () => {
            el.removeEventListener('webglcontextlost', onLost);
            el.removeEventListener('webglcontextrestored', onRestored);
        };
    }, [gl]);

    return null;
}

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
function InitialFraming({ islands, focusFolderId, initialCamera, returnDive }: InitialFramingProps) {
    const size = useThree((s) => s.size);
    const framedRef = useRef(false);

    useEffect(() => {
        if (framedRef.current || islands.length === 0) return;

        framedRef.current = true;
        const fit = fitCameraTo(islands, size.width / size.height);

        // Back from /document: land where the dive began with only a small
        // settle-in. Deliberately NO re-unravel and no reverse flight — the
        // pronounced enter animation reads well, replaying it backwards
        // doesn't. Suppression stops the controller from instantly
        // re-opening the folder the camera is still centered on.
        const diveCtx = getDiveContext();

        if (returnDive && diveCtx) {
            cam.target = { ...diveCtx.camBefore };
            cam.current = { ...diveCtx.camBefore, zoom: Math.min(1, diveCtx.camBefore.zoom + 0.04) };
            // Reopening requires the camera to leave the folder's zone and
            // come back (or a direct click on the island).
            unravelSuppression.add(diveCtx.folderId);
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
            requestFrame();

            return;
        }

        cam.target = { ...fit };
        cam.current = { ...fit, zoom: Math.max(0, fit.zoom - 0.06) };
        requestFrame();
    }, [islands, focusFolderId, initialCamera, size]);

    return null;
}

interface SceneHandleBridgeProps {
    handleRef: React.RefObject<CanvasSceneHandle | null> | undefined;
    islands: IslandLayout[];
}

function SceneHandleBridge({ handleRef, islands }: SceneHandleBridgeProps) {
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

export interface CanvasSceneComponentProps extends CanvasSceneProps {
    handleRef?: React.RefObject<CanvasSceneHandle | null>;
}

/**
 * The WebGL scene. Lazy-loaded (React.lazy) so three.js stays out of the
 * main bundle — nothing outside scene/ may import three or @react-three/*.
 */
export default function CanvasScene(props: CanvasSceneComponentProps) {
    const {
        islands,
        previews,
        unraveled,
        focusFolderId,
        initialCamera,
        returnDive,
        tuning: tuningProp,
        onCameraChange,
        onVisibleFoldersChange,
        onApproachFolder,
        onUnravelChange,
        onHoverDocument,
        onOpenDocument,
        onDiveHandoff,
        handleRef,
    } = props;
    const theme = useCanvasTheme();
    const islandsRef = useRef(islands);
    islandsRef.current = islands;

    // Reset the module-transient store exactly once per mount, DURING RENDER —
    // before any child effect can run. Doing this in a child's (layout)effect
    // raced InitialFraming under StrictMode replays: whichever ran last won,
    // sometimes leaving the camera stuck at the defaults.
    const resetRef = useRef(false);

    if (!resetRef.current) {
        resetRef.current = true;
        resetCanvasStore(initialCamera);
    }

    useEffect(() => {
        Object.assign(tuning, tuningProp);
    }, [tuningProp]);

    // R3F 9.6 occasionally misses its initial container measurement (StrictMode
    // double-root race) and idles at the default 300×150 canvas until any
    // resize; kick it once shortly after mount. Cheap and harmless when the
    // measurement succeeded.
    useEffect(() => {
        const kick = () => window.dispatchEvent(new Event('resize'));
        const t1 = setTimeout(kick, 60);
        const t2 = setTimeout(kick, 400);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, []);

    const handleCameraSettled = useCallback(
        (state: CameraState) => {
            onCameraChange(state);
            onVisibleFoldersChange(visibleIslandIds(state, islandsRef.current, window.innerWidth / window.innerHeight));
        },
        [onCameraChange, onVisibleFoldersChange],
    );

    useEffect(
        () => () => {
            disposeEmojiTextures();
            disposeAllTextures();
            document.body.style.cursor = '';
        },
        [],
    );

    return (
        <Canvas
            // "always" over "demand": the invalidate-on-demand wiring proved
            // fragile against R3F 9.6's init/StrictMode quirks (black first
            // paint, stalled animations when invalidations were swallowed).
            // The scene is ~200 unlit quads — continuous rendering is cheap.
            frameloop="always"
            dpr={[1, 2]}
            style={{ background: 'var(--background)' }}
            // alpha: an opaque WebGL canvas composites white before its first
            // frame (the ~20ms flash on back-navigation); with alpha the CSS
            // background shows through until the first render lands.
            // low-power: requesting the high-performance GPU can trigger a
            // discrete-GPU switch on dual-GPU Macs, which recomposites the
            // whole window (intermittent white flash on mount). The scene is
            // a few hundred unlit quads — the integrated GPU is plenty.
            gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
            onCreated={({ gl, scene, camera }) => {
                setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
                gl.domElement.style.background = 'var(--background)';
                gl.compile(scene, camera);
            }}
            onPointerMissed={(e) => {
                // Click-away (not a pan-release) collapses the open fan.
                const moved = Math.hypot(e.clientX - lastPointerDown.x, e.clientY - lastPointerDown.y);

                if (moved <= 7) collapseUnravel(onUnravelChange);
            }}
        >
            <color attach="background" args={[theme.background]} />
            <FrameDriver />
            <ContextLossGuard />
            <CameraRig onCameraSettled={handleCameraSettled} />
            <GroundGrid theme={theme} />
            <InitialFraming islands={islands} focusFolderId={focusFolderId} initialCamera={initialCamera} returnDive={returnDive} />
            <SceneHandleBridge handleRef={handleRef} islands={islands} />
            <UnravelController islands={islands} onUnravelChange={onUnravelChange} onApproachFolder={onApproachFolder} />
            <DiveController theme={theme} onDiveHandoff={onDiveHandoff} />
            <CollectionLabels islands={islands} theme={theme} />
            {islands.map((island) => (
                <FolderIsland key={island.id} island={island} theme={theme} onMoved={props.onIslandMoved} />
            ))}
            {islands.map((island) => {
                const islandPreviews = previews[island.id];

                if (!islandPreviews?.length) return null;

                return <IslandStack key={island.id} island={island} previews={islandPreviews} theme={theme} />;
            })}
            <UnraveledCards unraveled={unraveled} islands={islands} theme={theme} onHover={onHoverDocument} onOpen={onOpenDocument} />
        </Canvas>
    );
}
