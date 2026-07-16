import { THUMBNAIL_SIZES, type Document } from '@reverie/shared';
import type { DestRect } from './diveState.js';

/**
 * DOM half of the dive: a body-portal overlay showing the exact pixels the
 * WebGL flight ended on, held across the route swap, then FLIP-settled onto
 * the document page's real image and faded away. Imperative on purpose — it
 * must outlive the canvas route's React tree.
 */

const HEADER_H = 56;
const TOOLBAR_H = 56;

/**
 * Predict where ImageViewMode will paint the document. Layout is NOT mounted
 * on /canvas, so this is computed from known chrome constants (Sidebar w-64,
 * Header h-14, viewer pt-14 + paddings); the FLIP settle corrects residuals.
 */
export function computeDestRect(doc: Document): DestRect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    const sidebar = isDesktop ? 256 : 0;
    const padX = isDesktop ? 24 : 0;
    const padTop = HEADER_H + TOOLBAR_H + (isDesktop ? 24 : 16);
    const padBottom = isDesktop ? 32 : 24;

    const boxX = sidebar + padX;
    const boxY = padTop;
    const boxW = Math.max(1, vw - sidebar - padX * 2);
    const boxH = Math.max(1, vh - padTop - padBottom);

    // Contain-fit WITHOUT upscaling: the viewer's max-w/max-h constraints never
    // grow an image past its natural size, so predicting the padded box for a
    // small image made the dive overshoot and visibly shrink back on settle.
    // "Natural size" is the lg THUMBNAIL's, not the original's: the viewer hero
    // is content-sized by the lg thumb (width-capped, never enlarged) with the
    // full-res img absolutely positioned inside it — so on screens whose box
    // exceeds the cap, predicting from original dims overshoots the same way.
    if (doc.width && doc.height) {
        const capScale = Math.min(1, THUMBNAIL_SIZES.lg / doc.width);
        const effW = doc.width * capScale;
        const effH = doc.height * capScale;
        const scale = Math.min(boxW / effW, boxH / effH, 1);
        const w = effW * scale;
        const h = effH * scale;

        return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
    }

    const aspect = 4 / 3;
    let w = boxW;
    let h = w / aspect;

    if (h > boxH) {
        h = boxH;
        w = h * aspect;
    }

    return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

let overlayEl: HTMLDivElement | null = null;
let overlayImg: HTMLImageElement | null = null;

function nextFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(count);
    });
}

/**
 * Mount the full-viewport overlay (background-colored, image at the flight's
 * end rect) and resolve after it has provably painted — the caller navigates
 * only then, so the swap is pixel-stable.
 */
export async function mountDiveOverlay(rect: DestRect, imageUrl: string | null): Promise<void> {
    removeDiveOverlay();

    overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:50;background:var(--background);pointer-events:none;';

    if (imageUrl) {
        overlayImg = document.createElement('img');
        overlayImg.src = imageUrl;
        overlayImg.style.cssText =
            `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` + 'object-fit:contain;border-radius:4px;';
        overlayEl.appendChild(overlayImg);

        try {
            await Promise.race([overlayImg.decode(), new Promise((r) => setTimeout(r, 300))]);
        } catch {
            // Decode failure: the background-colored overlay still prevents a flash.
        }
    }

    document.body.appendChild(overlayEl);
    await nextFrames(2);
}

const SETTLE_TIMEOUT_MS = 1500;
const SETTLE_MOVE_MS = 160;
const FADE_MS = 130;

export interface SettleOptions {
    /** How long to wait for [data-doc-hero]. Non-image viewers (PDF/txt) never
     *  render one, so callers pass a short timeout to fade promptly instead of
     *  holding the backdrop for the full default. */
    heroTimeoutMs?: number;
}

/**
 * After navigation: find the document page's hero image ([data-doc-hero]),
 * FLIP the overlay image onto its real rect if prediction was off, then fade
 * the overlay out and remove it.
 */
export function settleDiveOverlay(options: SettleOptions = {}): void {
    const heroTimeoutMs = options.heroTimeoutMs ?? SETTLE_TIMEOUT_MS;
    const startedAt = performance.now();

    const tryToSettle = () => {
        if (!overlayEl) return;

        const hero = document.querySelector<HTMLElement>('[data-doc-hero]');

        if (!hero && performance.now() - startedAt < heroTimeoutMs) {
            requestAnimationFrame(tryToSettle);

            return;
        }

        const img = overlayImg;
        const target = hero?.getBoundingClientRect();

        if (img && target && target.width > 0) {
            const current = img.getBoundingClientRect();
            const moved =
                Math.abs(current.x - target.x) > 1 ||
                Math.abs(current.y - target.y) > 1 ||
                Math.abs(current.width - target.width) > 1 ||
                Math.abs(current.height - target.height) > 1;

            if (moved) {
                img.animate(
                    [
                        { left: current.x + 'px', top: current.y + 'px', width: current.width + 'px', height: current.height + 'px' },
                        { left: target.x + 'px', top: target.y + 'px', width: target.width + 'px', height: target.height + 'px', borderRadius: '0px' },
                    ],
                    { duration: SETTLE_MOVE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
                );
            }
        }

        const el = overlayEl;
        const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: FADE_MS,
            delay: SETTLE_MOVE_MS,
            easing: 'ease-out',
            fill: 'forwards',
        });
        fade.onfinish = () => removeDiveOverlay();
    };

    requestAnimationFrame(tryToSettle);
}

export function removeDiveOverlay(): void {
    overlayEl?.remove();
    overlayEl = null;
    overlayImg = null;
}
