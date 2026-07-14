import type { Document } from '@reverie/shared';
import type { CameraState } from '../types.js';

/**
 * Dive flight context, shared between the WebGL flight (scene/) and the DOM
 * overlay handoff (this folder, three-free). Module scope survives the
 * canvas route unmount, which is what makes the reverse re-entry possible.
 */

export const DIVE_MS = 420;

export interface DestRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface DiveContext {
    doc: Document;
    folderId: string;
    /** Fanned card center on the plane — the camera's flight destination. */
    cardX: number;
    cardZ: number;
    /** Flight end zoom, derived from the destination rect so the dolly lands
     *  exactly where the card fills it — no overshoot-then-shrink. */
    endZoom: number;
    camBefore: CameraState;
    destRect: DestRect;
    startedAt: number;
}

let context: DiveContext | null = null;

export function setDiveContext(next: DiveContext): void {
    context = next;
}

export function getDiveContext(): DiveContext | null {
    return context;
}

export function clearDiveContext(): void {
    context = null;
}
