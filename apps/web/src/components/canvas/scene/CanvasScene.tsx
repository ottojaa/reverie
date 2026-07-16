import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canvasQuality } from '../canvasQuality.js';
import { releaseReturnShield } from '../dive/returnShield.js';
import type { CameraState, CanvasSceneHandle, CanvasSceneProps } from '../types.js';
import { CameraRig } from './CameraRig.js';
import { CollectionLabels } from './CollectionLabels.js';
import { ContextLossGuard } from './ContextLossGuard.js';
import { requestFrame } from './dampers.js';
import { DiveController } from './DiveController.js';
import { FolderIsland } from './FolderIsland.js';
import { FrameDriver } from './FrameDriver.js';
import { visibleIslandIds } from './framing.js';
import { GroundGrid } from './GroundGrid.js';
import { InitialFraming } from './InitialFraming.js';
import { IslandStack } from './IslandStack.js';
import { disposeEmojiTextures } from './labelAssets.js';
import { ReturnShieldRelease } from './ReturnShieldRelease.js';
import { SceneHandleBridge } from './SceneHandleBridge.js';
import { lastPointerDown, resetCanvasStore, tuning, viewport } from './store.js';
import { disposeAllTextures, setMaxAnisotropy } from './textureCache.js';
import { useCanvasTheme } from './theme.js';
import { collapseUnravel, UnravelController } from './UnravelController.js';
import { UnravelDebug } from './UnravelDebug.js';
import { UnraveledCards } from './UnraveledCards.js';

/**
 * Keeps store.viewport in sync with the R3F size — render-body write so the
 * fan layout and entry framing see the real aspect before any effect runs.
 */
function ViewportSync() {
    const size = useThree((s) => s.size);
    viewport.aspect = size.width / Math.max(1, size.height);

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
        initialUnraveledFolderId,
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

    // Mount on "always" to ride out R3F 9.6's init races (missed container
    // measurement, StrictMode replays, the return-shield GPU fence), then hand
    // rendering to the damper registry's invalidate wiring on coarse-pointer
    // devices — continuous rendering is what cooks phone GPUs. Driven through
    // the PROP (React state), never useThree().setFrameloop: R3F re-applies
    // the prop on every Canvas re-render and would silently revert a child's
    // setFrameloop call. Desktop stays on "always" — a swallowed invalidation
    // there would freeze an animation for no battery win worth the risk.
    const [frameloop, setFrameloop] = useState<'always' | 'demand'>('always');

    useEffect(() => {
        if (!canvasQuality.demandFrameloop) return;

        const t = setTimeout(() => setFrameloop('demand'), 1500);

        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        // Prime one frame after the switch so nothing stalls mid-animation.
        if (frameloop === 'demand') requestFrame();
    }, [frameloop]);

    // Reset the module-transient store exactly once per mount, DURING RENDER —
    // before any child effect can run. Doing this in a child's (layout)effect
    // raced InitialFraming under StrictMode replays: whichever ran last won,
    // sometimes leaving the camera stuck at the defaults.
    const resetRef = useRef(false);

    if (!resetRef.current) {
        resetRef.current = true;
        resetCanvasStore(initialCamera, initialUnraveledFolderId);
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
            releaseReturnShield();
            document.body.style.cursor = '';
        },
        [],
    );

    return (
        <Canvas
            frameloop={frameloop}
            dpr={[1, canvasQuality.dprMax]}
            // touchAction none: without it mobile browsers claim single-finger
            // drags as native scroll gestures and pointercancel the pan.
            style={{ background: 'var(--background)', touchAction: 'none' }}
            // alpha: an opaque WebGL canvas composites white before its first
            // frame (the ~20ms flash on back-navigation); with alpha the CSS
            // background shows through until the first render lands.
            // low-power: requesting the high-performance GPU can trigger a
            // discrete-GPU switch on dual-GPU Macs, which recomposites the
            // whole window (intermittent white flash on mount). The scene is
            // a few hundred unlit quads — the integrated GPU is plenty.
            // antialias: MSAA is disproportionately expensive on mobile tile
            // GPUs; gl props are create-time only, and canvasQuality resolves
            // before first mount, so this never re-creates the context.
            gl={{ antialias: canvasQuality.antialias, alpha: true, powerPreference: 'low-power' }}
            onCreated={({ gl, scene, camera }) => {
                setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
                gl.domElement.style.background = 'var(--background)';
                // The style prop lands on R3F's wrapper div; set it on the
                // actual event target too so pointer capture is never contested.
                gl.domElement.style.touchAction = 'none';
                gl.compile(scene, camera);
            }}
            onPointerMissed={(e) => {
                // Click-away (not a pan-release) collapses the open fan.
                const moved = Math.hypot(e.clientX - lastPointerDown.x, e.clientY - lastPointerDown.y);

                if (moved <= canvasQuality.clickThresholdPx) collapseUnravel(onUnravelChange);
            }}
        >
            <color attach="background" args={[theme.background]} />
            <ViewportSync />
            <FrameDriver />
            <ReturnShieldRelease />
            <ContextLossGuard />
            <CameraRig onCameraSettled={handleCameraSettled} />
            <GroundGrid theme={theme} />
            <InitialFraming islands={islands} focusFolderId={focusFolderId} initialCamera={initialCamera} returnDive={returnDive} />
            <SceneHandleBridge handleRef={handleRef} islands={islands} />
            <UnravelController islands={islands} onUnravelChange={onUnravelChange} onApproachFolder={onApproachFolder} />
            {tuningProp.debugUnravel && <UnravelDebug islands={islands} />}
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
