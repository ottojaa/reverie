import { Color } from 'three';

/**
 * Write a hex color into a uniform Color WITHOUT color-space conversion.
 *
 * Our ShaderMaterials skip three's colorspace_fragment output encode, so
 * uniforms must carry raw sRGB components to land on screen as the authored
 * hex (matching scene.background, which round-trips through the renderer's
 * convert-then-encode path back to the same hex).
 */
export function setRawColor(target: Color, hex: string): Color {
    const n = parseInt(hex.slice(1), 16);

    return target.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
