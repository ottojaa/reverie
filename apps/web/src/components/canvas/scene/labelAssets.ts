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

/**
 * The island's far-zoom glyph. The `emoji` DB field usually holds a LUCIDE
 * ICON NAME ("image", "folder-open", …) that only the DOM can render — baking
 * it with fillText painted the word as giant black text. Only genuinely
 * pictographic values render as emoji; everything else gets a folder shape
 * drawn in the theme's muted color.
 */
export function getFolderGlyphTexture(value: string | null, color: string): CanvasTexture {
    if (value && /\p{Extended_Pictographic}/u.test(value)) return getEmojiTexture(value);

    const key = 'folder-glyph:' + color;
    const cached = emojiCache.get(key);

    if (cached) return cached;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        ctx.fillStyle = color;
        // Tab, then body — the classic folder silhouette.
        ctx.beginPath();
        ctx.roundRect(44, 66, 84, 40, 12);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(36, 92, 184, 104, 16);
        ctx.fill();
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    emojiCache.set(key, texture);

    return texture;
}

export function disposeEmojiTextures(): void {
    emojiCache.forEach((texture) => texture.dispose());
    emojiCache.clear();
}
