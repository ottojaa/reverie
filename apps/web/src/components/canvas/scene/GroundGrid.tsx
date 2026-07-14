import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Mesh, Vector2 } from 'three';
import { zoomToDist } from './cameraMath.js';
import { requestFrame } from './dampers.js';
import { setRawColor } from './glColor.js';
import { cam } from './store.js';
import type { CanvasTheme } from './theme.js';

const VERTEX = /* glsl */ `
    varying vec3 vWorld;
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

// World-space dot grid, anti-aliased with fwidth, fading out toward the
// camera's focus horizon so the plane dissolves into the background before
// any hard edge could show under the tilt.
const FRAGMENT = /* glsl */ `
    uniform vec3 uBg;
    uniform vec3 uDot;
    uniform float uSpacing;
    uniform float uDotRadius;
    uniform vec2 uFocus;
    uniform float uFadeRadius;
    varying vec3 vWorld;
    void main() {
        vec2 g = mod(vWorld.xz, uSpacing) - uSpacing * 0.5;
        float d = length(g);
        float aa = fwidth(d) + 1e-4;
        float dotMask = 1.0 - smoothstep(uDotRadius - aa, uDotRadius + aa, d);
        float fade = 1.0 - smoothstep(uFadeRadius * 0.45, uFadeRadius, distance(vWorld.xz, uFocus));
        gl_FragColor = vec4(mix(uBg, uDot, dotMask * fade * 0.55), 1.0);
    }
`;

const PLANE_SIZE = 1600;
const DOT_SPACING = 4;

/** Infinite-feeling dotted ground: the mesh follows the camera focus while
 *  the dots stay pinned in world space (pattern derives from vWorld). */
export function GroundGrid({ theme }: { theme: CanvasTheme }) {
    const meshRef = useRef<Mesh>(null);

    const uniforms = useMemo(
        () => ({
            uBg: { value: new Color() },
            uDot: { value: new Color() },
            uSpacing: { value: DOT_SPACING },
            uDotRadius: { value: 0.16 },
            uFocus: { value: new Vector2() },
            uFadeRadius: { value: 300 },
        }),
        [],
    );

    useEffect(() => {
        setRawColor(uniforms.uBg.value, theme.background);
        setRawColor(uniforms.uDot.value, theme.border);
        requestFrame();
    }, [theme, uniforms]);

    useFrame(() => {
        const mesh = meshRef.current;

        if (!mesh) return;

        mesh.position.set(cam.current.x, 0, cam.current.z);
        uniforms.uFocus.value.set(cam.current.x, cam.current.z);
        uniforms.uFadeRadius.value = zoomToDist(cam.current.zoom) * 3;
    });

    return (
        <mesh ref={meshRef} rotation-x={-Math.PI / 2} renderOrder={-1}>
            <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
            <shaderMaterial vertexShader={VERTEX} fragmentShader={FRAGMENT} uniforms={uniforms} />
        </mesh>
    );
}
