import type { CameraState } from './types.js';

/**
 * Camera state persisted across the /canvas ↔ /document round trip.
 * Module variable first (the canvas route chunk stays loaded), mirrored to
 * sessionStorage so an Electron reload also restores the view.
 */
export interface CanvasSession {
    camera: CameraState;
    unraveledFolderId: string | null;
}

const STORAGE_KEY = 'reverie:canvas-session:v1';

let session: CanvasSession | null = null;

export function saveCanvasSession(next: CanvasSession): void {
    session = next;

    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage full/denied — the module variable still covers in-app navigation.
    }
}

export function loadCanvasSession(): CanvasSession | null {
    if (session) return session;

    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);

        if (!raw) return null;

        session = JSON.parse(raw) as CanvasSession;
    } catch {
        return null;
    }

    return session;
}
