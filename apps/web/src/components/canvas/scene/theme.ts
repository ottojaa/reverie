import { useEffect, useState } from 'react';

/**
 * Theme colors resolved to hex for three.js. The app's CSS variables are
 * oklch() (styles.css), which THREE.Color cannot parse — resolve them by
 * painting onto a 1×1 2D canvas and reading the pixel back.
 */
export interface CanvasTheme {
    background: string;
    foreground: string;
    card: string;
    primary: string;
    border: string;
    mutedForeground: string;
}

let scratchCtx: CanvasRenderingContext2D | null = null;

function toHexColor(cssColor: string): string {
    if (!scratchCtx) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        scratchCtx = canvas.getContext('2d', { willReadFrequently: true });
    }

    if (!scratchCtx) return '#808080';

    scratchCtx.fillStyle = '#808080';
    scratchCtx.fillStyle = cssColor;
    scratchCtx.fillRect(0, 0, 1, 1);
    const data = scratchCtx.getImageData(0, 0, 1, 1).data;

    return '#' + ((1 << 24) | ((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0)).toString(16).slice(1);
}

function readVar(style: CSSStyleDeclaration, name: string): string {
    return toHexColor(style.getPropertyValue(name).trim());
}

export function readCanvasTheme(): CanvasTheme {
    const style = getComputedStyle(document.documentElement);

    return {
        background: readVar(style, '--background'),
        foreground: readVar(style, '--foreground'),
        card: readVar(style, '--card'),
        primary: readVar(style, '--primary'),
        border: readVar(style, '--border'),
        mutedForeground: readVar(style, '--muted-foreground'),
    };
}

/**
 * Live theme colors — re-reads when the `dark` class on <html> flips
 * (lib/theme.tsx toggles it), so the scene restyles without a remount.
 */
export function useCanvasTheme(): CanvasTheme {
    const [theme, setTheme] = useState<CanvasTheme>(readCanvasTheme);

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(readCanvasTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, []);

    return theme;
}
