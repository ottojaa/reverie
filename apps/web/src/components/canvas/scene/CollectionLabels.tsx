import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Group } from 'three';
import type { IslandLayout } from '../types.js';
import { requestFrame } from './dampers.js';
import { applyGroupOpacity, focusDimFor } from './focusDim.js';
import { LABEL_FONT_URL } from './labelAssets.js';
import type { CanvasTheme } from './theme.js';

interface CollectionLabelsProps {
    islands: IslandLayout[];
    theme: CanvasTheme;
}

interface LabelSpot {
    id: string;
    name: string;
    x: number;
    northZ: number;
    fontSize: number;
}

/** One muted, uppercase region label above each collection cluster. */
export function CollectionLabels({ islands, theme }: CollectionLabelsProps) {
    const groupRef = useRef<Group>(null);

    // Section titles recede with everything else while a folder is unraveled.
    useFrame(() => {
        if (groupRef.current) applyGroupOpacity(groupRef.current, focusDimFor(null));
    });

    const labels = useMemo(() => {
        const groups = new Map<string, { name: string; minX: number; maxX: number; minZ: number; radius: number }>();

        for (const island of islands) {
            if (!island.collectionId || !island.collectionName) continue;

            const group = groups.get(island.collectionId) ?? {
                name: island.collectionName,
                minX: Infinity,
                maxX: -Infinity,
                minZ: Infinity,
                radius: island.radius,
            };
            group.minX = Math.min(group.minX, island.position.x);
            group.maxX = Math.max(group.maxX, island.position.x);
            group.minZ = Math.min(group.minZ, island.position.z - island.radius);
            groups.set(island.collectionId, group);
        }

        return Array.from(groups, ([id, g]): LabelSpot => {
            // Title scales with the cluster's width so a one-folder section
            // doesn't wear a banner twice its own size.
            const extent = g.maxX - g.minX + g.radius * 2;

            return {
                id,
                name: g.name,
                x: (g.minX + g.maxX) / 2,
                northZ: g.minZ - 1.2,
                fontSize: Math.min(2.4, Math.max(1.1, extent * 0.13)),
            };
        });
    }, [islands]);

    return (
        <group ref={groupRef}>
            {labels.map((label) => (
                <Text
                    key={label.id}
                    position={[label.x, 0.05, label.northZ]}
                    rotation-x={-Math.PI / 2}
                    fontSize={label.fontSize}
                    color={theme.mutedForeground}
                    fillOpacity={0.55}
                    anchorX="center"
                    anchorY="bottom"
                    font={LABEL_FONT_URL}
                    letterSpacing={0.12}
                    onSync={requestFrame}
                >
                    {label.name.toUpperCase()}
                </Text>
            ))}
        </group>
    );
}
