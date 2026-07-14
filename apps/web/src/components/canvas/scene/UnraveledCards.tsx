import { useFrame } from '@react-three/fiber';
import type { Document } from '@reverie/shared';
import { useEffect, useRef, useState } from 'react';
import type { IslandLayout, UnraveledFolder } from '../types.js';
import { DocumentCard3D } from './DocumentCard3D.js';
import { unravelValue } from './store.js';
import type { CanvasTheme } from './theme.js';
import { fanLayout } from './unravel.js';

interface UnraveledCardsProps {
    unraveled: UnraveledFolder | null;
    islands: IslandLayout[];
    theme: CanvasTheme;
    onHover: (doc: Document) => void;
    onOpen: (doc: Document) => void;
}

/**
 * Mounts the fanned card grid for the unraveled folder. The previous
 * folder's cards stay mounted while their unravelT eases back to 0 (max two
 * concurrent sets), then unmount.
 */
export function UnraveledCards({ unraveled, islands, theme, onHover, onOpen }: UnraveledCardsProps) {
    const [fading, setFading] = useState<UnraveledFolder | null>(null);
    const prevRef = useRef<UnraveledFolder | null>(null);
    const fadingRef = useRef<UnraveledFolder | null>(null);
    fadingRef.current = fading;

    useEffect(() => {
        const prev = prevRef.current;
        const currentId = unraveled?.folderId ?? null;

        if (prev && prev.folderId !== currentId) setFading(prev);

        if (unraveled) setFading((f) => (f?.folderId === unraveled.folderId ? null : f));

        prevRef.current = unraveled;
    }, [unraveled]);

    useFrame(() => {
        const f = fadingRef.current;

        if (f && unravelValue(f.folderId) < 0.005) setFading(null);
    });

    const sets = fading && fading.folderId !== unraveled?.folderId ? [unraveled, fading] : [unraveled];

    return (
        <>
            {sets.map((set) => {
                if (!set) return null;

                const island = islands.find((i) => i.id === set.folderId);

                if (!island) return null;

                const poses = fanLayout(set.documents, island);

                return set.documents.map((doc, i) => {
                    const pose = poses[i];

                    if (!pose) return null;

                    return (
                        <DocumentCard3D key={doc.id} doc={doc} pose={pose} folderId={set.folderId} index={i} theme={theme} onHover={onHover} onOpen={onOpen} />
                    );
                });
            })}
        </>
    );
}
