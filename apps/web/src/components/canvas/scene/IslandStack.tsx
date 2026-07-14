import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useFrame } from '@react-three/fiber';
import type { Document } from '@reverie/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Mesh } from 'three';
import { hash01 } from '../layout/computeIslandLayout.js';
import type { IslandLayout } from '../types.js';
import { cardGeometry, makeCardMaterial, type CardUniforms } from './cardMaterial.js';
import { clamp, damp, easeOutBack, requestFrame } from './dampers.js';
import { focusDimFor } from './focusDim.js';
import { islandDrag, unravelValue, zoomBand } from './store.js';
import { acquireTexture, getBlurhashTexture, getSolidTexture, releaseTexture, type TextureEntry } from './textureCache.js';
import type { CanvasTheme } from './theme.js';

const STACK_COUNT = 3;

interface StackCard {
    doc: Document;
    w: number;
    h: number;
    yaw: number;
    dx: number;
    dz: number;
    y: number;
    material: ReturnType<typeof makeCardMaterial>;
}

interface IslandStackProps {
    island: IslandLayout;
    previews: Document[];
    theme: CanvasTheme;
}

/**
 * The gathered-state preview: top documents as a casual pile on the plate,
 * crossfading away as the folder unravels (parent-fades-as-children-reveal).
 */
export function IslandStack({ island, previews, theme }: IslandStackProps) {
    const groupRef = useRef<Group>(null);
    const meshRefs = useRef<(Mesh | null)[]>([]);
    const mixRefs = useRef<number[]>([]);
    const entriesRef = useRef<Map<string, TextureEntry>>(new Map());

    const docIds = previews
        .slice(0, STACK_COUNT)
        .map((d) => d.id)
        .join(',');

    const cards: StackCard[] = useMemo(() => {
        return previews.slice(0, STACK_COUNT).map((doc, i, all) => {
            const size = island.radius * 0.62;
            const aspect = doc.width && doc.height ? doc.width / doc.height : 4 / 3;
            const h = aspect >= 1 ? size / aspect : size;
            const placeholder = doc.thumbnail_blurhash ? getBlurhashTexture(doc.thumbnail_blurhash) : getSolidTexture(theme.border);

            return {
                doc,
                w: h * aspect,
                h,
                yaw: (hash01(doc.id + ':sy') - 0.5) * 0.5,
                dx: (hash01(doc.id + ':sx') - 0.5) * island.radius * 0.3,
                dz: (hash01(doc.id + ':sz') - 0.5) * island.radius * 0.3,
                y: 0.1 + (all.length - i) * 0.015,
                material: makeCardMaterial(placeholder, aspect, theme.primary),
            };
        });
        // docIds captures the identity of the doc set; previews array identity churns
    }, [docIds, island.radius]);

    useEffect(() => {
        const map = entriesRef.current;

        for (const card of cards) {
            const url = getThumbnailUrl(card.doc, 'sm');

            if (!url || card.doc.thumbnail_status !== 'complete') continue;

            map.set(card.doc.id, acquireTexture(card.doc.id, 'sm', url, 1));
        }

        return () => {
            map.forEach(releaseTexture);
            map.clear();
        };
    }, [cards]);

    useEffect(() => () => cards.forEach((card) => card.material.dispose()), [cards]);

    useFrame((_, dt) => {
        const group = groupRef.current;

        if (!group) return;

        // Follow the island while it's being drag-nudged.
        const dragging = islandDrag.id === island.id;
        group.position.set(dragging ? islandDrag.x : island.position.x, 0, dragging ? islandDrag.z : island.position.z);

        // Semantic-zoom LOD: the pile only exists inside the unravel band —
        // outside it the island shows its folder glyph instead (FolderIsland).
        const band = zoomBand.current;
        const opacity = band * (1 - unravelValue(island.id)) * focusDimFor(island.id);
        group.visible = opacity > 0.012;

        if (!group.visible) return;

        cards.forEach((card, i) => {
            const mesh = meshRefs.current[i];
            // Staggered pop: each card bursts out of the glyph a beat after
            // the one above it, growing with a small overshoot before
            // settling — and squashes back in the same way on the way out.
            const t = clamp(band * 1.2 - i * 0.1, 0, 1);
            const pop = easeOutBack(t);

            if (mesh) {
                const emerge = 0.55 + 0.45 * pop;
                const scale = 0.35 + 0.65 * pop;
                mesh.position.set(card.dx * emerge, card.y, card.dz * emerge);
                mesh.rotation.z = card.yaw * (0.4 + 0.6 * pop);
                mesh.scale.set(card.w * scale, card.h * scale, 1);
            }

            const uniforms = card.material.uniforms as unknown as CardUniforms;
            const entry = entriesRef.current.get(card.doc.id);

            if (entry?.texture && uniforms.uMap.value !== entry.texture) uniforms.uMap.value = entry.texture;

            const mixTarget = entry?.texture ? 1 : 0;
            const mix = mixRefs.current[i] ?? 0;

            if (Math.abs(mixTarget - mix) > 1e-3) {
                mixRefs.current[i] = damp(mix, mixTarget, 6, Math.min(dt, 0.1));
                requestFrame();
            }

            uniforms.uMix.value = mixRefs.current[i] ?? 0;
            uniforms.uOpacity.value = (1 - unravelValue(island.id)) * focusDimFor(island.id) * clamp(t * 1.5, 0, 1);
        });
    });

    return (
        <group ref={groupRef} position={[island.position.x, 0, island.position.z]}>
            {cards.map((card, i) => (
                <mesh
                    key={card.doc.id}
                    ref={(mesh) => {
                        meshRefs.current[i] = mesh;
                    }}
                    geometry={cardGeometry}
                    material={card.material}
                    position={[card.dx, card.y, card.dz]}
                    rotation={[-Math.PI / 2, 0, card.yaw]}
                    scale={[card.w, card.h, 1]}
                    renderOrder={5 + (STACK_COUNT - i)}
                    // Display-only: rays must pass through to the island plate
                    // below, whose group owns click-to-focus and drag-to-nudge.
                    raycast={noopRaycast}
                />
            ))}
        </group>
    );
}

function noopRaycast(): void {
    // intentionally empty — this mesh is invisible to the raycaster
}
