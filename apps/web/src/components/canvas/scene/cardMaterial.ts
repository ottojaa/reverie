import { Color, DoubleSide, PlaneGeometry, ShaderMaterial, Texture } from 'three';
import { setRawColor } from './glColor.js';

/**
 * Shared card shader: SDF rounded-corner alpha mask, blurhash→thumbnail
 * crossfade, and a hover glow ring — one draw call per card, resolution-
 * independent corners at any zoom. Skips three's colorspace encode, so all
 * inputs are raw sRGB (see textureCache.ts / glColor.ts).
 */

const VERTEX = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT = /* glsl */ `
    uniform sampler2D uMap;
    uniform sampler2D uPlaceholder;
    uniform float uMix;
    uniform float uOpacity;
    uniform float uRadius;
    uniform float uAspect;
    uniform vec3 uGlow;
    uniform float uGlowAmt;
    varying vec2 vUv;
    void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec2 halfSize = vec2(uAspect, 1.0) * 0.5 - uRadius;
        vec2 q = abs(p) - halfSize;
        float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uRadius;
        float aa = fwidth(d) + 1e-4;
        float alpha = 1.0 - smoothstep(-aa, aa, d);
        if (alpha * uOpacity < 0.01) discard;
        vec3 img = mix(texture2D(uPlaceholder, vUv), texture2D(uMap, vUv), uMix).rgb;
        float ring = (1.0 - smoothstep(0.0, 0.05, abs(d + 0.02))) * uGlowAmt;
        gl_FragColor = vec4(mix(img, uGlow, ring), alpha * uOpacity);
    }
`;

export interface CardUniforms {
    uMap: { value: Texture };
    uPlaceholder: { value: Texture };
    uMix: { value: number };
    uOpacity: { value: number };
    uRadius: { value: number };
    uAspect: { value: number };
    uGlow: { value: Color };
    uGlowAmt: { value: number };
}

/** All cards share one unit plane; meshes scale to their letterboxed size. */
export const cardGeometry = new PlaneGeometry(1, 1);

export function makeCardMaterial(placeholder: Texture, aspect: number, glowHex: string): ShaderMaterial {
    const uniforms: CardUniforms = {
        uMap: { value: placeholder },
        uPlaceholder: { value: placeholder },
        uMix: { value: 0 },
        uOpacity: { value: 0 },
        uRadius: { value: 0.06 },
        uAspect: { value: aspect },
        uGlow: { value: setRawColor(new Color(), glowHex) },
        uGlowAmt: { value: 0 },
    };

    return new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: uniforms as unknown as ShaderMaterial['uniforms'],
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
    });
}
