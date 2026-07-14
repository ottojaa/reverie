import { useAuth } from '@/lib/auth';
import type { FolderWithChildren } from '@reverie/shared';
import { produce } from 'immer';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { canvasLayoutKey, EMPTY_LAYOUT_STORE, pruneStalePositions, type CanvasLayoutStore } from '../layout/canvasLayoutStorage.js';
import { computeIslandLayout } from '../layout/computeIslandLayout.js';
import type { IslandLayout, PlanePosition } from '../types.js';

interface UseCanvasLayoutResult {
    islands: IslandLayout[];
    moveIsland: (folderId: string, position: PlanePosition) => void;
    resetLayout: () => void;
    hasOverrides: boolean;
}

/** Auto-computed island layout merged with the user's drag overrides. */
export function useCanvasLayout(tree: FolderWithChildren[] | undefined): UseCanvasLayoutResult {
    const { user } = useAuth();
    const [store, setStore] = useLocalStorage<CanvasLayoutStore>(canvasLayoutKey(user?.id ?? 'anonymous'), EMPTY_LAYOUT_STORE);

    const islands = useMemo(() => {
        if (!tree?.length) return [];

        return computeIslandLayout(tree).map((island) => {
            const override = store.positions[island.id];

            return override ? { ...island, position: override } : island;
        });
    }, [tree, store]);

    const validIdsRef = useRef<ReadonlySet<string>>(new Set());

    useEffect(() => {
        validIdsRef.current = new Set(islands.map((i) => i.id));
    }, [islands]);

    const moveIsland = useCallback(
        (folderId: string, position: PlanePosition) => {
            setStore((prev) =>
                pruneStalePositions(
                    produce(prev, (draft) => {
                        draft.positions[folderId] = position;
                    }),
                    validIdsRef.current,
                ),
            );
        },
        [setStore],
    );

    const resetLayout = useCallback(() => setStore(EMPTY_LAYOUT_STORE), [setStore]);

    return { islands, moveIsland, resetLayout, hasOverrides: Object.keys(store.positions).length > 0 };
}
