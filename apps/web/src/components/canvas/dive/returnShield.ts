import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Full-viewport background-colored shield for /document → /canvas
 * navigations. The WebGL canvas is a brand-new compositor surface on every
 * mount, and until its first frame presents the compositor may flash the
 * surface blank/white — CSS backgrounds on html/body/wrapper can't cover a
 * surface that has no frame yet. A plain DOM element can: it is part of the
 * already-presented frames on both sides of the swap (the same trick the
 * forward dive overlay uses, which has never flashed).
 *
 * Mounted by a root-level router subscription BEFORE the document route
 * unmounts; released by the scene after its first few rendered frames.
 */

const AUTO_RELEASE_MS = 2500;
const FADE_MS = 150;

let shieldEl: HTMLDivElement | null = null;
let autoRelease: ReturnType<typeof setTimeout> | null = null;

export function mountReturnShield(): void {
    if (shieldEl) return;

    shieldEl = document.createElement('div');
    shieldEl.style.cssText = 'position:fixed;inset:0;z-index:50;background:var(--background);pointer-events:none;';
    document.body.appendChild(shieldEl);
    // Failsafe: never trap the user behind the shield if the scene errors out.
    autoRelease = setTimeout(releaseReturnShield, AUTO_RELEASE_MS);
}

export function releaseReturnShield(): void {
    const el = shieldEl;

    if (!el) return;

    shieldEl = null;

    if (autoRelease) {
        clearTimeout(autoRelease);
        autoRelease = null;
    }

    const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' });
    fade.onfinish = () => el.remove();
}

/**
 * Shield any /document → /canvas navigation (in-app back button, browser
 * back, swipe — they all pass through the router). Must live in a component
 * that never unmounts (the root route).
 */
export function useCanvasReturnShield(): void {
    const router = useRouter();

    useEffect(
        () =>
            router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
                if (fromLocation?.pathname.startsWith('/document/') && toLocation.pathname.startsWith('/canvas')) {
                    mountReturnShield();
                }
            }),
        [router],
    );
}
