import { Text } from '@react-three/drei';
import { useMemo } from 'react';
import type { IslandLayout } from '../types.js';
import { requestFrame } from './dampers.js';
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
}

/** One muted, uppercase region label above each collection cluster. */
export function CollectionLabels({ islands, theme }: CollectionLabelsProps) {
    const labels = useMemo(() => {
        const groups = new Map<string, { name: string; xs: number[]; minZ: number }>();

        for (const island of islands) {
            if (!island.collectionId || !island.collectionName) continue;

            const group = groups.get(island.collectionId) ?? { name: island.collectionName, xs: [], minZ: Infinity };
            group.xs.push(island.position.x);
            group.minZ = Math.min(group.minZ, island.position.z - island.radius);
            groups.set(island.collectionId, group);
        }

        return Array.from(groups, ([id, g]): LabelSpot => {
            const x = g.xs.reduce((a, b) => a + b, 0) / g.xs.length;

            return { id, name: g.name, x, northZ: g.minZ - 3 };
        });
    }, [islands]);

    return (
        <>
            {labels.map((label) => (
                <Text
                    key={label.id}
                    position={[label.x, 0.05, label.northZ]}
                    rotation-x={-Math.PI / 2}
                    fontSize={2.4}
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
        </>
    );
}
