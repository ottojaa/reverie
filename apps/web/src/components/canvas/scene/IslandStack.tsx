import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useFrame } from '@react-three/fiber';
import type { Document } from '@reverie/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Mesh } from 'three';
import type { IslandLayout } from '../types.js';
import { cardGeometry, makeCardMaterial, type CardUniforms } from './cardMaterial.js';
import { clamp, damp, ease, easeOutBack, lerp, requestFrame } from './dampers.js';
import { focusDimFor } from './focusDim.js';
import { islandDrag, unravelValue, zoomBand } from './store.js';
import { acquireTexture, getBlurhashTexture, getSolidTexture, releaseTexture, type TextureEntry } from './textureCache.js';
import type { CanvasTheme } from './theme.js';
import { STACK_COUNT, stackSlot } from './unravel.js';

// Launch/landing y INSIDE the plate: the plate top (y 0.06) depth-writes, so
// cards below it are genuinely occluded — they emerge from and sink into the
// folder instead of fading in mid-air.
const Y_INSIDE = 0.02;
const PLATE_TOP = 0.06;
// Drop shadows live just above the plate; cards separate from them as they
// rise — the strongest height cue an unlit scene can offer.
const Y_SHADOW = 0.085;
const SHADOW_ALPHA = 0.3;
// The stack starts rising almost with the glyph's dip (band-space delay,
// ~25ms through the zoomBand damper — yield and pop read as one gesture),
// each card trailing the previous. Rate is sized so the last card lands at
// band ≈ 0.85, before the damper's asymptotic tail turns the fan into a crawl.
const CARD_DELAY = 0.12;
const CARD_RATE = 1.6;
const CARD_STAGGER = 0.08;
// The exit is the enter played backwards in wall-clock, which needs its own
// band-space constants: a falling band spends the damper's fast half near 1,
// so the gather/slurp runs there (band 1→0.17) and the glyph climbs back out
// after the cards are inside (FolderIsland). The rate is sized so every card
// sits exactly at t=1 when the band target flips — no pop at the turnaround.
const CARD_EXIT_FLOOR = 0.17;
const CARD_EXIT_RATE = 1.4;

interface StackCard {
    doc: Document;
    w: number;
    h: number;
    yaw: number;
    dx: number;
    dz: number;
    y: number;
    material: ReturnType<typeof makeCardMaterial>;
    shadowMaterial: ReturnType<typeof makeCardMaterial>;
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
    const shadowRefs = useRef<(Mesh | null)[]>([]);
    const mixRefs = useRef<number[]>([]);
    const entriesRef = useRef<Map<string, TextureEntry>>(new Map());

    const docIds = previews
        .slice(0, STACK_COUNT)
        .map((d) => d.id)
        .join(',');

    const cards: StackCard[] = useMemo(() => {
        return previews.slice(0, STACK_COUNT).map((doc, i) => {
            const slot = stackSlot(doc, island);
            const placeholder = doc.thumbnail_blurhash ? getBlurhashTexture(doc.thumbnail_blurhash) : getSolidTexture(theme.border);

            return {
                doc,
                w: slot.w,
                h: slot.h,
                yaw: slot.yaw,
                dx: slot.dx,
                dz: slot.dz,
                y: 0.1 + (STACK_COUNT - i) * 0.015,
                material: makeCardMaterial(placeholder, slot.w / slot.h, theme.primary),
                // Same rounded-corner SDF shape, solid black — a card-shaped shadow.
                shadowMaterial: makeCardMaterial(getSolidTexture('#000000'), slot.w / slot.h, theme.primary),
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

    useEffect(
        () => () =>
            cards.forEach((card) => {
                card.material.dispose();
                card.shadowMaterial.dispose();
            }),
        [cards],
    );

    useFrame((_, dt) => {
        const group = groupRef.current;

        if (!group) return;

        // Follow the island while it's being drag-nudged.
        const dragging = islandDrag.id === island.id;
        group.position.set(dragging ? islandDrag.x : island.position.x, 0, dragging ? islandDrag.z : island.position.z);

        // Semantic-zoom LOD: the pile only exists inside the unravel band —
        // outside it the island shows its folder glyph instead (FolderIsland).
        const band = zoomBand.current;
        const entering = zoomBand.target >= 0.5;
        const opacity = band * (1 - unravelValue(island.id)) * focusDimFor(island.id);
        group.visible = opacity > 0.012;

        if (!group.visible) return;

        cards.forEach((card, i) => {
            const mesh = meshRefs.current[i];
            const shadowMesh = shadowRefs.current[i];
            // One path per direction, staggered per card. Entering: the stack
            // springs up out of the plate as one tight cluster, overlapping
            // the glyph's dip (FolderIsland), scattering mid-rise so
            // pop-and-fan is one motion. Exiting plays that backwards — the
            // pile gathers, then slurps below (LIFO: the top card is the last
            // one in), and only then does the glyph climb back out.
            const t = entering
                ? clamp((band - CARD_DELAY) * CARD_RATE - i * CARD_STAGGER, 0, 1)
                : clamp((band - CARD_EXIT_FLOOR) * CARD_EXIT_RATE - i * CARD_STAGGER, 0, 1);
            // The pop (easeOutBack) is enter-only: run backwards, its
            // overshoot region makes the pile hover above the plate before
            // dropping, so the exit dives on a plain smoothstep instead.
            const rise = entering ? easeOutBack(t) : ease(t);
            // Scatter from t 0.3: easeOutBack is front-loaded, so cards are at
            // ~90% height by then — the fan never happens below the plate.
            const scatter = ease(clamp((t - 0.3) / 0.7, 0, 1));
            const x = card.dx * scatter;
            const z = card.dz * scatter;
            const y = lerp(Y_INSIDE, card.y, rise);
            const scale = 0.25 + 0.75 * rise;

            if (mesh) {
                mesh.position.set(x, y, z);
                // The settle tilt must flatten at the bottom of the slot: a
                // tilted card resting INSIDE the plate (rise 0) pokes its top
                // edge above the depth-written plate top, which lingers as a
                // dark sliver across the glyph until the band fully decays.
                // Flat at rest, full tilt by rise 0.15 — still well below the
                // breach point, so the visible emergence is unchanged.
                mesh.rotation.x = -Math.PI / 2 + (1 - rise) * 0.4 * clamp(rise / 0.15, 0, 1);
                mesh.rotation.z = card.yaw * scatter;
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
            // No fade in either direction — the plate's depth occlusion does
            // the revealing and the swallowing, so the motion stays physical.
            const cardOpacity = (1 - unravelValue(island.id)) * focusDimFor(island.id);
            uniforms.uOpacity.value = cardOpacity;

            if (shadowMesh) {
                // The shadow stays grounded while the card lifts — separating,
                // drifting, spreading and fading with height — and only exists
                // once the card has actually cleared the plate.
                const height = Math.max(0, y - Y_SHADOW);
                const soften = 1 + height * 0.3;
                const emerged = clamp((y - PLATE_TOP) / 0.06, 0, 1);
                shadowMesh.position.set(x + 0.05 + height * 0.22, Y_SHADOW, z + 0.08 + height * 0.3);
                shadowMesh.rotation.z = card.yaw * scatter;
                shadowMesh.scale.set(card.w * scale * soften, card.h * scale * soften, 1);
                const shadowUniforms = card.shadowMaterial.uniforms as unknown as CardUniforms;
                shadowUniforms.uOpacity.value = (cardOpacity * SHADOW_ALPHA * emerged) / soften;
            }
        });
    });

    return (
        <group ref={groupRef} position={[island.position.x, 0, island.position.z]}>
            {cards.map((card, i) => (
                <mesh
                    key={'shadow:' + card.doc.id}
                    ref={(mesh) => {
                        shadowRefs.current[i] = mesh;
                    }}
                    geometry={cardGeometry}
                    material={card.shadowMaterial}
                    position={[card.dx, Y_SHADOW, card.dz]}
                    rotation={[-Math.PI / 2, 0, card.yaw]}
                    scale={[card.w, card.h, 1]}
                    renderOrder={4}
                    raycast={noopRaycast}
                />
            ))}
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
