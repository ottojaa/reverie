import { usePrefetchInfiniteDocuments } from '@/lib/api/documents';
import { useIsReturningFromDocument } from '@/lib/hooks/useNavigationDirection';
import { useSections } from '@/lib/sections';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { CanvasLoading } from './CanvasLoading.js';
import { CanvasOverlay } from './CanvasOverlay.js';
import { loadCanvasSession, saveCanvasSession } from './canvasSession.js';
import { getDiveContext } from './dive/diveState.js';
import { useCanvasLayout } from './hooks/useCanvasLayout.js';
import { useIslandPreviews } from './hooks/useIslandPreviews.js';
import { useOpenDocumentFromCanvas } from './hooks/useOpenDocumentFromCanvas.js';
import { useUnraveledDocuments } from './hooks/useUnraveledDocuments.js';
import type { CanvasSceneComponentProps } from './scene/CanvasScene.js';
import { DEFAULT_CAMERA_TUNING, type CameraState, type CameraTuning, type CanvasSceneHandle } from './types.js';

/**
 * Dynamic import WITHOUT React.lazy/Suspense (same pattern as Document.tsx's
 * useDynamicViewer): mounting an R3F <Canvas> through a Suspense reveal makes
 * its size observer measure a 0×0 container, and the scene then stays black
 * until an unrelated window resize. Mounting after the chunk resolves avoids
 * the race while keeping three.js out of the main bundle.
 */
function useCanvasSceneComponent(): ComponentType<CanvasSceneComponentProps> | null {
    const [Scene, setScene] = useState<ComponentType<CanvasSceneComponentProps> | null>(null);

    useEffect(() => {
        let cancelled = false;

        import('./scene/CanvasScene.js').then((mod) => {
            if (!cancelled) setScene(() => mod.default);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return Scene;
}

const SEED_FOLDER_COUNT = 12;

export function CanvasPage() {
    const { focus } = useSearch({ from: '/canvas' });
    const router = useRouter();
    const navigate = useNavigate();
    const sceneHandleRef = useRef<CanvasSceneHandle | null>(null);
    const returningFromDocument = useIsReturningFromDocument();
    const CanvasScene = useCanvasSceneComponent();

    const { data: sections, isLoading: isTreeLoading } = useSections();
    const { islands, moveIsland, resetLayout, hasOverrides } = useCanvasLayout(sections);
    const [storedTuning, setTuning] = useLocalStorage<CameraTuning>('reverie:canvas-feel:v1', DEFAULT_CAMERA_TUNING);
    // Merge over defaults so settings added later get values on old stores.
    const tuning = useMemo(() => ({ ...DEFAULT_CAMERA_TUNING, ...storedTuning }), [storedTuning]);
    const [visibleFolderIds, setVisibleFolderIds] = useState<string[]>([]);
    // Restored on back-navigation so the fan you dove from is open again —
    // the scene seeds it fully open (no replayed unravel animation). Keyed on
    // the surviving DiveContext, NOT the pathname-based returningFromDocument:
    // code-split routes can mount a pass after the root's location commit,
    // which makes the pathname check unreliable, while a render-phase read of
    // the dive context always wins against InitialFraming's effect-time clear.
    const [unraveledFolderId, setUnraveledFolderId] = useState<string | null>(() => getDiveContext()?.folderId ?? null);
    // First-render value only: the scene reads it once, during its mount reset.
    const initialUnraveledFolderId = useRef(unraveledFolderId).current;
    const { prefetchDocument, openDocument, completeDive } = useOpenDocumentFromCanvas();

    // Islands with documents that are visible (or among the first few by tree
    // order, so the entry view is never blank) get their previews fetched.
    const previewFolderIds = useMemo(() => {
        const withDocs = new Set(islands.filter((i) => i.documentCount > 0).map((i) => i.id));
        const seeds = islands
            .filter((i) => withDocs.has(i.id))
            .slice(0, SEED_FOLDER_COUNT)
            .map((i) => i.id);
        const visible = visibleFolderIds.filter((id) => withDocs.has(id));

        return Array.from(new Set([...visible, ...seeds]));
    }, [islands, visibleFolderIds]);

    const previews = useIslandPreviews(previewFolderIds);
    const unraveled = useUnraveledDocuments(unraveledFolderId);
    const prefetchFolder = usePrefetchInfiniteDocuments();

    const exit = useCallback(() => {
        if (router.history.canGoBack()) {
            router.history.back();

            return;
        }

        navigate({ to: '/browse' });
    }, [router, navigate]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') exit();
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [exit]);

    const unraveledIdRef = useRef<string | null>(null);
    unraveledIdRef.current = unraveledFolderId;

    const handleCameraChange = useCallback((camera: CameraState) => {
        saveCanvasSession({ camera, unraveledFolderId: unraveledIdRef.current });
    }, []);

    const handleUnravelChange = useCallback((folderId: string | null) => {
        setUnraveledFolderId(folderId);
        // The camera-settle save alone misses fans opened without a subsequent
        // settle (e.g. clicking a folder the camera is already parked on) —
        // keep the session's unravel state fresh so back-nav restores it.
        const session = loadCanvasSession();

        if (session) saveCanvasSession({ camera: session.camera, unraveledFolderId: folderId });
    }, []);

    const unraveledIsland = unraveledFolderId ? (islands.find((i) => i.id === unraveledFolderId) ?? null) : null;

    const initialCamera = focus && !returningFromDocument ? null : (loadCanvasSession()?.camera ?? null);

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-background">
            {CanvasScene ? (
                <CanvasScene
                    islands={islands}
                    previews={previews}
                    unraveled={unraveled}
                    focusFolderId={returningFromDocument ? null : (focus ?? null)}
                    initialCamera={initialCamera}
                    initialUnraveledFolderId={initialUnraveledFolderId}
                    returnDive={returningFromDocument}
                    tuning={tuning}
                    onVisibleFoldersChange={setVisibleFolderIds}
                    onApproachFolder={prefetchFolder}
                    onUnravelChange={handleUnravelChange}
                    onIslandMoved={moveIsland}
                    onHoverDocument={prefetchDocument}
                    onOpenDocument={openDocument}
                    onDiveHandoff={completeDive}
                    onCameraChange={handleCameraChange}
                    handleRef={sceneHandleRef}
                />
            ) : (
                <CanvasLoading />
            )}
            {isTreeLoading && islands.length === 0 && <CanvasLoading />}
            {!isTreeLoading && islands.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <p className="text-sm font-medium text-foreground">Nothing on the canvas yet</p>
                        <p className="text-sm text-muted-foreground">Create folders in your library and they&apos;ll appear here as islands.</p>
                    </div>
                </div>
            )}
            <CanvasOverlay
                onExit={exit}
                onZoomIn={() => sceneHandleRef.current?.zoomBy(0.08)}
                onZoomOut={() => sceneHandleRef.current?.zoomBy(-0.08)}
                onZoomToFit={() => sceneHandleRef.current?.zoomToFit()}
                tuning={tuning}
                onTuningChange={setTuning}
                onResetLayout={hasOverrides ? resetLayout : undefined}
                unraveledFolder={
                    unraveledIsland && unraveled
                        ? { id: unraveledIsland.id, name: unraveledIsland.name, shown: unraveled.documents.length, total: unraveled.totalCount }
                        : null
                }
            />
        </div>
    );
}
