import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { canvasQuality } from '../canvasQuality.js';
import type { IslandLayout, PlanePosition } from '../types.js';
import { groundPlane } from './cameraMath.js';
import { clamp, ease, requestFrame } from './dampers.js';
import { focusCameraOn } from './framing.js';
import { getFolderGlyphTexture, LABEL_FONT_URL } from './labelAssets.js';
import { applyGroupOpacity, focusDimFor } from './focusDim.js';
import { cam, isDiving, islandDrag, unravelRequest, unravelValue, zoomBand } from './store.js';
import type { CanvasTheme } from './theme.js';

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
    const iconRef = useRef<Mesh>(null);
    const iconMatRef = useRef<MeshBasicMaterial>(null);
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

        // Semantic-zoom LOD: the glyph is the folder's far representation.
        // It holds steady while the cards hop out (they burst from a folder
        // the user can still see) and only fades once they've landed —
        // delayed against the band. Empty folders have no pile to make way
        // for, so their glyph stays at every zoom.
        // Semantic-zoom LOD: entering the pile band, the glyph gives way by
        // dipping INTO the plate — dimming to half and shrinking a touch as it
        // sinks below the depth-written plate top — and the stack rises out a
        // beat later (IslandStack's CARD_DELAY). A falling band plays it
        // backwards: the pile slurps below, then the glyph climbs back out.
        // Empty folders have no pile, so their glyph never gives way.
        const glyphT = documentCount === 0 ? 0 : ease(clamp(zoomBand.current / 0.5, 0, 1));
        const icon = iconRef.current;
        const iconMat = iconMatRef.current;

        if (icon && iconMat) {
            const opacity = (1 - 0.5 * glyphT) * dim;
            icon.visible = opacity > 0.02;
            iconMat.opacity = opacity;
            icon.position.y = 0.1 - glyphT * 0.14;
            icon.scale.setScalar(1 - 0.15 * glyphT);
        }

        // …and name/count additionally make way for this island's own fan.
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

                // Explicitly release R3F's internal capture: the automatic
                // lostpointercapture cleanup is deferred to the next rAF, and
                // until it runs every intersect includes this island — which
                // suppresses onPointerMissed (click-away) after any island
                // click, indefinitely so in a hidden/throttled tab.
                (e.target as Element).releasePointerCapture(e.pointerId);
                dragRef.current = null;
                islandDrag.id = null;

                if (e.delta > canvasQuality.clickThresholdPx) {
                    onMoved(island.id, { x: islandDrag.x, z: islandDrag.z });

                    return;
                }

                // A click (no drag): fly the camera onto this folder and fan
                // it out on arrival — the only way a folder ever opens.
                unravelRequest.current = { islandId: island.id, immediate: false };
                cam.target = focusCameraOn(island);
                requestFrame();
            }}
            onPointerOver={() => {
                if (isDraggable()) document.body.style.cursor = 'grab';

                requestFrame();
            }}
            onPointerOut={() => {
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
            <mesh ref={iconRef} rotation-x={-Math.PI / 2} position-y={0.1} renderOrder={3}>
                <planeGeometry args={[radius * 0.85, radius * 0.85]} />
                <meshBasicMaterial ref={iconMatRef} map={getFolderGlyphTexture(emoji, theme.mutedForeground)} transparent depthWrite={false} />
            </mesh>
            <group ref={fadeGroupRef}>
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
