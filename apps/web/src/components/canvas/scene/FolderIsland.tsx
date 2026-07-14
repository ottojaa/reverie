import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group, Vector3 } from 'three';
import type { IslandLayout, PlanePosition } from '../types.js';
import { groundPlane } from './cameraMath.js';
import { requestFrame } from './dampers.js';
import { focusCameraOn } from './framing.js';
import { getEmojiTexture, LABEL_FONT_URL } from './labelAssets.js';
import { applyGroupOpacity, focusDimFor } from './focusDim.js';
import { cam, hover, isDiving, islandDrag, unravelSuppression, unravelValue } from './store.js';
import type { CanvasTheme } from './theme.js';

const CLICK_THRESHOLD_PX = 7;
const dragHit = new Vector3();

interface FolderIslandProps {
    island: IslandLayout;
    theme: CanvasTheme;
    onMoved: (folderId: string, position: PlanePosition) => void;
}

/**
 * A folder rendered as a flat island: contact-shadow blob, card-colored
 * plate, emoji, and name/count labels lying on the ground. The plate is also
 * the drag handle (nudge layout) and click target (fly to folder).
 */
export function FolderIsland({ island, theme, onMoved }: FolderIslandProps) {
    const { position, radius, name, emoji, documentCount } = island;
    const groupRef = useRef<Group>(null);
    const baseGroupRef = useRef<Group>(null);
    const fadeGroupRef = useRef<Group>(null);
    const dragRef = useRef<{ pointerId: number; grabDx: number; grabDz: number } | null>(null);
    const labelSize = Math.min(1.4, Math.max(0.8, radius * 0.3));

    useFrame(() => {
        const group = groupRef.current;

        if (!group) return;

        const dragging = islandDrag.id === island.id;
        group.position.set(dragging ? islandDrag.x : position.x, 0, dragging ? islandDrag.z : position.z);

        // Recede while another folder is unraveled (focus dim)…
        const dim = focusDimFor(island.id);

        if (baseGroupRef.current) applyGroupOpacity(baseGroupRef.current, dim);

        // …and name/count/emoji additionally make way for this island's own fan.
        const fadeGroup = fadeGroupRef.current;

        if (fadeGroup) {
            const fade = (1 - unravelValue(island.id)) * dim;
            fadeGroup.visible = fade > 0.02;
            applyGroupOpacity(fadeGroup, fade);
        }
    });

    const isDraggable = () => !isDiving() && unravelValue(island.id) < 0.05;

    return (
        <group
            ref={groupRef}
            position={[position.x, 0, position.z]}
            onPointerDown={(e) => {
                if (!isDraggable() || e.button !== 0) return;

                e.stopPropagation();
                (e.target as Element).setPointerCapture(e.pointerId);

                if (!e.ray.intersectPlane(groundPlane, dragHit)) return;

                const current = groupRef.current?.position ?? { x: position.x, z: position.z };
                dragRef.current = { pointerId: e.pointerId, grabDx: current.x - dragHit.x, grabDz: current.z - dragHit.z };
                islandDrag.id = island.id;
                islandDrag.x = position.x;
                islandDrag.z = position.z;
                requestFrame();
            }}
            onPointerMove={(e) => {
                const drag = dragRef.current;

                if (!drag || drag.pointerId !== e.pointerId) return;

                if (!e.ray.intersectPlane(groundPlane, dragHit)) return;

                islandDrag.x = dragHit.x + drag.grabDx;
                islandDrag.z = dragHit.z + drag.grabDz;
                requestFrame();
            }}
            onPointerUp={(e) => {
                const drag = dragRef.current;

                if (!drag || drag.pointerId !== e.pointerId) return;

                dragRef.current = null;
                islandDrag.id = null;

                if (e.delta > CLICK_THRESHOLD_PX) {
                    onMoved(island.id, { x: islandDrag.x, z: islandDrag.z });

                    return;
                }

                // A click (no drag): fly the camera onto this folder. Explicit
                // intent overrides any click-away/back-nav suppression.
                unravelSuppression.delete(island.id);
                cam.target = focusCameraOn(island);
                requestFrame();
            }}
            onPointerOver={() => {
                hover.islandId = island.id;

                if (isDraggable()) document.body.style.cursor = 'grab';

                requestFrame();
            }}
            onPointerOut={() => {
                if (hover.islandId === island.id) hover.islandId = null;

                if (document.body.style.cursor === 'grab') document.body.style.cursor = '';

                requestFrame();
            }}
        >
            <group ref={baseGroupRef}>
                <mesh rotation-x={-Math.PI / 2} position-y={0.02} renderOrder={0}>
                    <circleGeometry args={[radius * 1.14, 48]} />
                    <meshBasicMaterial color="#000000" transparent opacity={0.14} depthWrite={false} />
                </mesh>
                <mesh rotation-x={-Math.PI / 2} position-y={0.06} renderOrder={1}>
                    <circleGeometry args={[radius, 48]} />
                    <meshBasicMaterial color={theme.card} />
                </mesh>
                <mesh rotation-x={-Math.PI / 2} position-y={0.07} renderOrder={2}>
                    <ringGeometry args={[radius * 0.97, radius, 48]} />
                    <meshBasicMaterial color={theme.border} transparent opacity={0.7} depthWrite={false} />
                </mesh>
            </group>
            <group ref={fadeGroupRef}>
                {emoji && (
                    <mesh rotation-x={-Math.PI / 2} position-y={0.1} renderOrder={3}>
                        <planeGeometry args={[radius * 0.85, radius * 0.85]} />
                        <meshBasicMaterial map={getEmojiTexture(emoji)} transparent depthWrite={false} />
                    </mesh>
                )}
                <Text
                    position={[0, 0.1, radius + 0.9]}
                    rotation-x={-Math.PI / 2}
                    fontSize={labelSize}
                    color={theme.foreground}
                    anchorX="center"
                    anchorY="top"
                    font={LABEL_FONT_URL}
                    maxWidth={radius * 3.2}
                    textAlign="center"
                    onSync={requestFrame}
                >
                    {name}
                </Text>
                <Text
                    position={[0, 0.1, radius + 1.2 + labelSize * 1.4]}
                    rotation-x={-Math.PI / 2}
                    fontSize={labelSize * 0.62}
                    color={theme.mutedForeground}
                    anchorX="center"
                    anchorY="top"
                    font={LABEL_FONT_URL}
                    onSync={requestFrame}
                >
                    {documentCount === 1 ? '1 document' : documentCount + ' documents'}
                </Text>
            </group>
        </group>
    );
}
