import { decode } from 'blurhash';
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, Texture } from 'three';
import { canvasQuality } from '../canvasQuality.js';
import { requestFrame } from './dampers.js';

/**
 * Thumbnail texture pipeline: fetch → createImageBitmap (off-main-thread
 * decode) → Texture, through a small priority queue with cancellation, into
 * an LRU keyed by `docId:size` — NOT by URL, because thumbnail URLs are
 * signed and rotate (same lesson as ImageViewMode's locked URLs).
 *
 * Color management note: textures stay in NoColorSpace on purpose — the card
 * shader skips three's output encode, so raw sRGB in = correct pixels out.
 */

type EntryState = 'queued' | 'loading' | 'ready' | 'error';

export interface TextureEntry {
    key: string;
    url: string;
    state: EntryState;
    texture: Texture | null;
    refs: number;
    priority: number;
    abort: AbortController | null;
}

const MAX_INFLIGHT = canvasQuality.maxInflightTextures;
const IDLE_BUDGET = canvasQuality.idleTextureBudget;

const entries = new Map<string, TextureEntry>();
let inflight = 0;
let maxAnisotropy = 1;

export function setMaxAnisotropy(value: number): void {
    maxAnisotropy = value;
}

function startNext(): void {
    if (inflight >= MAX_INFLIGHT) return;

    let best: TextureEntry | null = null;

    for (const entry of entries.values()) {
        if (entry.state !== 'queued' || entry.refs === 0) continue;

        if (!best || entry.priority > best.priority) best = entry;
    }

    if (!best) return;

    void load(best);
    startNext();
}

async function load(entry: TextureEntry): Promise<void> {
    entry.state = 'loading';
    entry.abort = new AbortController();
    inflight++;

    try {
        const res = await fetch(entry.url, { signal: entry.abort.signal });

        if (!res.ok) throw new Error('Thumbnail fetch failed: ' + res.status);

        const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY' });
        const texture = new Texture(bitmap);
        texture.flipY = false;
        texture.generateMipmaps = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.anisotropy = Math.min(canvasQuality.anisotropy, maxAnisotropy);
        texture.needsUpdate = true;
        entry.texture = texture;
        entry.state = 'ready';
        requestFrame();
    } catch (err) {
        entry.state = 'error';

        if (!(err instanceof DOMException && err.name === 'AbortError')) {
            console.warn('Canvas thumbnail load failed: ' + entry.key, err);
        }
    } finally {
        entry.abort = null;
        inflight--;
        startNext();
        evictIdle();
    }
}

function evictIdle(): void {
    const idle: TextureEntry[] = [];

    for (const entry of entries.values()) {
        if (entry.refs === 0 && entry.state !== 'loading') idle.push(entry);
    }

    // Map preserves insertion order — oldest acquisitions evict first.
    const excess = idle.length - IDLE_BUDGET;

    for (let i = 0; i < excess; i++) {
        const entry = idle[i];

        if (!entry) continue;

        entry.texture?.dispose();
        entries.delete(entry.key);
    }
}

/**
 * Acquire a texture ref for a document thumbnail. Returns the live entry —
 * poll `entry.texture` from useFrame (a requestFrame() fires on arrival).
 * Refcounted so StrictMode double-effects are safe.
 */
export function acquireTexture(docId: string, size: 'sm' | 'lg', url: string, priority: number): TextureEntry {
    const key = docId + ':' + size;
    const existing = entries.get(key);

    if (existing) {
        existing.refs++;
        existing.priority = Math.max(existing.priority, priority);

        // Signed URLs rotate; refresh the URL for a future retry after error.
        if (existing.state === 'error') {
            existing.url = url;
            existing.state = 'queued';
            startNext();
        }

        return existing;
    }

    const entry: TextureEntry = { key, url, state: 'queued', texture: null, refs: 1, priority, abort: null };
    entries.set(key, entry);
    startNext();

    return entry;
}

export function releaseTexture(entry: TextureEntry): void {
    entry.refs = Math.max(0, entry.refs - 1);

    if (entry.refs === 0 && entry.state === 'loading') {
        entry.abort?.abort();
        entries.delete(entry.key);

        return;
    }

    if (entry.refs === 0 && entry.state === 'queued') {
        entries.delete(entry.key);

        return;
    }

    evictIdle();
}

const blurhashCache = new Map<string, DataTexture>();

/** Synchronous 32×32 placeholder texture decoded from a blurhash. */
export function getBlurhashTexture(hash: string): DataTexture {
    const cached = blurhashCache.get(hash);

    if (cached) return cached;

    const pixels = decode(hash, 32, 32);
    // blurhash rows are top-first; texture UV origin is bottom-left — and
    // flipY is ignored for typed-array uploads, so flip the rows manually.
    const flipped = new Uint8Array(pixels.length);
    const rowBytes = 32 * 4;

    for (let row = 0; row < 32; row++) {
        flipped.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), (31 - row) * rowBytes);
    }

    const texture = new DataTexture(flipped, 32, 32, RGBAFormat);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    blurhashCache.set(hash, texture);

    return texture;
}

const fallbackCache = new Map<string, DataTexture>();

/** 1×1 solid color placeholder for documents without a blurhash. */
export function getSolidTexture(hex: string): DataTexture {
    const cached = fallbackCache.get(hex);

    if (cached) return cached;

    const n = parseInt(hex.slice(1), 16);
    const texture = new DataTexture(new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]), 1, 1, RGBAFormat);
    texture.needsUpdate = true;
    fallbackCache.set(hex, texture);

    return texture;
}

/** Route-leave cleanup: dispose everything, including live refs. */
export function disposeAllTextures(): void {
    entries.forEach((entry) => {
        entry.abort?.abort();
        entry.texture?.dispose();
    });
    entries.clear();
    blurhashCache.forEach((texture) => texture.dispose());
    blurhashCache.clear();
    fallbackCache.forEach((texture) => texture.dispose());
    fallbackCache.clear();
    inflight = 0;
}
