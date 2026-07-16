import { formatDate, getThumbnailUrl } from '@/lib/commonhelpers';
import { Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Document } from '@reverie/shared';
import { useEffect, useMemo, useRef } from 'react';
import { Euler, Mesh, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { canvasQuality } from '../canvasQuality.js';
import { DIVE_MS, getDiveContext } from '../dive/diveState.js';
import { cardGeometry, makeCardMaterial, type CardUniforms } from './cardMaterial.js';
import { HANDOFF_CARD_DEPTH, requestDive } from './DiveController.js';
import { clamp, damp, ease, lerp, requestFrame } from './dampers.js';
import { setRawColor } from './glColor.js';
import { LABEL_FONT_URL } from './labelAssets.js';
import { getCanvasSnapshot, hover, isDiving, unravelAnims, unravelValue } from './store.js';
import { acquireTexture, getBlurhashTexture, getSolidTexture, releaseTexture, type TextureEntry } from './textureCache.js';
import type { CanvasTheme } from './theme.js';
import { cardProgress, type CardPose } from './unravel.js';

const NAME_MAX_CHARS = 26;

function truncateName(name: string): string {
    return name.length > NAME_MAX_CHARS ? name.slice(0, NAME_MAX_CHARS - 1) + '…' : name;
}

/** Troika Text mesh with the material opacity we drive per frame. */
type LabelMesh = Mesh & { material: { opacity: number; transparent: boolean } };

const scratchPosA = new Vector3();
const scratchPosB = new Vector3();
const scratchQuatA = new Quaternion();
const scratchEuler = new Euler();

const HOVER_LIFT = 0.5;
const EPS = 1e-3;

interface DocumentCard3DProps {
    doc: Document;
    pose: CardPose;
    folderId: string;
    index: number;
    theme: CanvasTheme;
    onHover: (doc: Document) => void;
    onOpen: (doc: Document) => void;
}

/**
 * One document thumbnail card, animating between its stacked home on the
 * island and its fanned grid slot as the folder's unravelT moves. All motion
 * writes straight to the mesh in useFrame — no React state in the hot path.
 */
export function DocumentCard3D({ doc, pose, folderId, index, theme, onHover, onOpen }: DocumentCard3DProps) {
    const meshRef = useRef<Mesh>(null);
    const nameRef = useRef<LabelMesh>(null);
    const dateRef = useRef<LabelMesh>(null);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const liftRef = useRef(0);
    const mixRef = useRef(0);
    const entryRef = useRef<TextureEntry | null>(null);

    // Material identity must stay stable for the card's lifetime; theme-derived
    // uniforms (glow) are refreshed per frame instead of by re-creation.
    const material = useMemo(
        () =>
            makeCardMaterial(
                doc.thumbnail_blurhash ? getBlurhashTexture(doc.thumbnail_blurhash) : getSolidTexture(theme.border),
                pose.w / pose.h,
                theme.primary,
            ),
        // mount-only by design: doc identity is fixed per mounted card
        [],
    );
    const uniforms = material.uniforms as unknown as CardUniforms;

    useEffect(() => () => material.dispose(), [material]);

    const smUrl = getThumbnailUrl(doc, 'sm');

    useEffect(() => {
        if (!smUrl || doc.thumbnail_status !== 'complete') return;

        const entry = acquireTexture(doc.id, 'sm', smUrl, 2);
        entryRef.current = entry;

        return () => {
            releaseTexture(entry);
            entryRef.current = null;
        };
    }, [doc.id, doc.thumbnail_status, smUrl]);

    useFrame((_, dt) => {
        const mesh = meshRef.current;

        if (!mesh) return;

        const setLabelFade = (fade: number) => {
            for (const label of [nameRef.current, dateRef.current]) {
                if (!label) continue;

                label.visible = fade > 0.02;
                label.material.transparent = true;
                label.material.opacity = fade;
            }
        };

        const diveCtx = getDiveContext();

        // Diving card: blend from the fan pose toward the analytic camera-space
        // pose whose projection equals the predicted DOM rect — exact under any
        // tilt, no camera inverse-solve (see plan: dive-in transition).
        if (diveCtx && getCanvasSnapshot().divePhase !== 'idle' && diveCtx.doc.id === doc.id) {
            const p = Math.min(1, (performance.now() - diveCtx.startedAt) / DIVE_MS);
            const blend = ease(clamp((p - 0.5) / 0.5, 0, 1));
            const { fanned } = pose;
            const { destRect } = diveCtx;

            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const halfH = Math.tan(((camera.fov / 2) * Math.PI) / 180);
            const depth = HANDOFF_CARD_DEPTH;
            const ndcX = ((destRect.x + destRect.w / 2) / vw) * 2 - 1;
            const ndcY = -(((destRect.y + destRect.h / 2) / vh) * 2 - 1);
            const worldH = 2 * depth * halfH * (destRect.h / vh);
            const worldW = worldH * (destRect.w / destRect.h);

            scratchPosA.set(fanned.x, fanned.y, fanned.z);
            scratchPosB.set(ndcX * depth * halfH * camera.aspect, ndcY * depth * halfH, -depth);
            camera.localToWorld(scratchPosB);
            scratchQuatA.setFromEuler(scratchEuler.set(-Math.PI / 2, 0, fanned.yaw));

            mesh.position.lerpVectors(scratchPosA, scratchPosB, blend);
            mesh.quaternion.copy(scratchQuatA).slerp(camera.quaternion, blend);
            mesh.scale.set(lerp(pose.w, worldW, blend), lerp(pose.h, worldH, blend), 1);
            mesh.visible = true;
            mesh.renderOrder = 600;
            material.depthTest = false;
            uniforms.uOpacity.value = 1;
            uniforms.uGlowAmt.value = 0;
            uniforms.uRadius.value = lerp(0.06, 0.005, blend);
            setLabelFade(1 - ease(Math.min(1, p * 2)));
            requestFrame();

            return;
        }

        material.depthTest = true;

        const step = Math.min(dt, 0.1);
        // Collapse without the ripple stagger — a uniform retract reads cleaner
        // in reverse than the mirrored fan-out ripple.
        const collapsing = (unravelAnims.get(folderId)?.target ?? 0) === 0;
        const raw = unravelValue(folderId);
        const t = ease(collapsing ? raw : cardProgress(raw, index));

        const hovered = hover.docId === doc.id && t > 0.95;
        const liftTarget = hovered ? 1 : 0;
        let animating = false;

        if (Math.abs(liftTarget - liftRef.current) > EPS) {
            liftRef.current = damp(liftRef.current, liftTarget, 14, step);
            animating = true;
        }

        const texture = entryRef.current?.texture ?? null;

        if (texture && uniforms.uMap.value !== texture) uniforms.uMap.value = texture;

        const mixTarget = texture ? 1 : 0;

        if (Math.abs(mixTarget - mixRef.current) > EPS) {
            mixRef.current = damp(mixRef.current, mixTarget, 6, step);
            animating = true;
        }

        const { home, fanned } = pose;
        mesh.position.set(lerp(home.x, fanned.x, t), lerp(home.y, fanned.y, t) + liftRef.current * HOVER_LIFT, lerp(home.z, fanned.z, t));
        mesh.rotation.set(-Math.PI / 2, 0, lerp(home.yaw, fanned.yaw, t));
        const s = lerp(home.scale, fanned.scale, t);
        mesh.scale.set(pose.w * s, pose.h * s, 1);

        uniforms.uMix.value = mixRef.current;
        uniforms.uOpacity.value = t;
        uniforms.uGlowAmt.value = liftRef.current * 0.85;
        setRawColor(uniforms.uGlow.value, theme.primary);
        mesh.visible = t > 0.012;
        mesh.renderOrder = 10 + index;

        // Labels appear only once the card has (mostly) reached its fan slot.
        setLabelFade(ease(clamp((t - 0.72) / 0.28, 0, 1)));

        if (animating) requestFrame();
    });

    const labelZ = pose.fanned.z + pose.h / 2;

    return (
        <>
            <Text
                ref={nameRef}
                position={[pose.fanned.x, 0.12, labelZ + 0.32]}
                rotation-x={-Math.PI / 2}
                fontSize={0.3}
                color={theme.foreground}
                anchorX="center"
                anchorY="top"
                font={LABEL_FONT_URL}
                visible={false}
                onSync={requestFrame}
            >
                {truncateName(doc.original_filename)}
            </Text>
            {/* Skipped on coarse-pointer devices — halves the troika Text count per fan. */}
            {canvasQuality.cardDateLabels && (
                <Text
                    ref={dateRef}
                    position={[pose.fanned.x, 0.12, labelZ + 0.78]}
                    rotation-x={-Math.PI / 2}
                    fontSize={0.24}
                    color={theme.mutedForeground}
                    anchorX="center"
                    anchorY="top"
                    font={LABEL_FONT_URL}
                    visible={false}
                    onSync={requestFrame}
                >
                    {formatDate(doc.created_at)}
                </Text>
            )}
            <mesh
                ref={meshRef}
                geometry={cardGeometry}
                material={material}
                visible={false}
                onPointerOver={(e) => {
                    e.stopPropagation();
                    hover.docId = doc.id;
                    document.body.style.cursor = 'pointer';
                    onHover(doc);
                    requestFrame();
                }}
                onPointerOut={() => {
                    if (hover.docId === doc.id) hover.docId = null;

                    document.body.style.cursor = '';
                    requestFrame();
                }}
                onClick={(e) => {
                    e.stopPropagation();

                    // Suppress clicks at the end of a camera-pan drag.
                    if (e.delta > canvasQuality.clickThresholdPx || isDiving()) return;

                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        onOpen(doc);

                        return;
                    }

                    requestDive(doc, pose, folderId);
                }}
            />
        </>
    );
}
