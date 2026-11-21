/** Pure helpers for playing a video's HLS renditions; the player itself lives in useHlsSource. */

/** `AUTO_QUALITY` lets hls.js pick the rung; any other value is a rung's index. */
export const AUTO_QUALITY = -1;

export interface QualityLevel {
    /** Index into hls.js's level list; the value to set `currentLevel` to. */
    index: number;
    label: string;
}

/** Picture size of a rung, as the ladder defines it: by the shorter side, so portrait videos read like landscape ones. */
export function toQualityLabel(level: { width?: number; height?: number; bitrate?: number }): string {
    const shorterSide = Math.min(level.width || Infinity, level.height || Infinity);

    if (Number.isFinite(shorterSide)) return `${shorterSide}p`;

    if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;

    return 'Unknown';
}

/** Rungs best-first, as a player's menu lists them. */
export function toQualityLevels(levels: { width?: number; height?: number; bitrate?: number }[]): QualityLevel[] {
    return levels.map((level, index) => ({ index, label: toQualityLabel(level) })).sort((a, b) => b.index - a.index);
}

/**
 * The key of the transcode set a master URL points at (`/files/hls/{exp}/{sig}/{key}/master.m3u8`), which stays the
 * same when a refetch signs the set again. Null for anything else.
 */
export function toSetKey(hlsUrl: string | null): string | null {
    if (!hlsUrl) return null;

    return /\/files\/hls\/\d+\/[^/]+\/([0-9a-f]{64})\//.exec(hlsUrl)?.[1] ?? null;
}

/** A rendition request the server refused because the token ran out (410) or no longer verifies (403). */
export function isTokenRefusal(status: number | undefined): boolean {
    return status === 403 || status === 410;
}
