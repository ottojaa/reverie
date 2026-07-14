import interWoff from '@fontsource/inter/files/inter-latin-500-normal.woff';
import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * Bundled label font for troika <Text> — without an explicit font, troika
 * fetches its default from a CDN at runtime, a hidden network dependency we
 * don't want in the Electron build.
 */
export const LABEL_FONT_URL: string = interWoff;

const emojiCache = new Map<string, CanvasTexture>();

/** Color emoji can't render in troika's SDF text — bake to a texture quad instead. */
export function getEmojiTexture(emoji: string): CanvasTexture {
    const cached = emojiCache.get(emoji);

    if (cached) return cached;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        ctx.font = '200px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, size / 2, size / 2 + 12);
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    emojiCache.set(emoji, texture);

    return texture;
}

export function disposeEmojiTextures(): void {
    emojiCache.forEach((texture) => texture.dispose());
    emojiCache.clear();
}
