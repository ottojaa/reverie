import { RUNG_NAMES } from './ladder';

export interface NvencShare {
    /** How many NVENC encodes the card's driver runs at once. */
    limit: number;
    /** How many normal and how many background videos can be encoding at once. */
    normalEncodes: number;
    backgroundEncodes: number;
}

/**
 * The most NVENC sessions one background encode may open. A ladder holds one session per rung while it encodes. Every
 * normal encode that can be running keeps a full ladder's worth free, and the background encodes share what is left, so a
 * normal encode is never refused a session because of them.
 */
export function toBackgroundNvencSessions({ limit, normalEncodes, backgroundEncodes }: NvencShare): number {
    const spare = limit - normalEncodes * RUNG_NAMES.length;

    return Math.max(0, Math.floor(spare / backgroundEncodes));
}
