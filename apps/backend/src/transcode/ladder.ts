/**
 * Which renditions a video gets. Pure: the stored ffprobe facts in, a list of rungs out.
 *
 * A rung is named by the displayed picture's shorter side, so a portrait phone clip (1080x1920 once rotated) has a
 * "1080p" rung at 1080x1920, the same pixels as a landscape 1920x1080 one. Nothing is upscaled: a source gets every
 * rung at or below its shorter side, and one below the smallest rung gets a single rung at its own size.
 */

export const RUNG_NAMES = [1080, 720, 480] as const;

/** Output frame rates above this are capped: phones record 120 and 240 fps slow motion. */
export const MAX_FRAME_RATE = 60;

export interface SourceFacts {
    /** The coded size; `rotation` says how a player turns it. */
    width: number;
    height: number;
    /** Degrees clockwise: 0, 90, 180 or 270. */
    rotation: number;
    frameRate: number | null;
    isHdr: boolean;
    /** The stored transfer function (`arib-std-b67` for HLG, `smpte2084` for PQ); picks the tone-map chain, not the rungs. */
    colorTransfer: string | null;
    /** The stored matrix and pixel format; an SDR source that is not BT.709 limited range is converted to it. */
    colorSpace: string | null;
    pixelFormat: string | null;
    /** False for a video with no audio stream, which has no audio to map. */
    hasAudio: boolean;
}

export interface Rung {
    /** The shorter side the rung is named for (the source's own, for a rung below 480). */
    name: number;
    /** Upright output size, both even. */
    width: number;
    height: number;
    /** Target and ceiling bitrates in bits per second. */
    bitrate: number;
    maxrate: number;
    bufsize: number;
}

export interface Ladder {
    rungs: Rung[];
    /** True when the picture is turned by ffmpeg; the output then carries no rotation. */
    rotated: boolean;
    /** The output frame rate when the source's is above the cap; null to keep it. */
    frameRateCap: number | null;
}

/** Target bitrate by rung name, in bits per second (H.264 High, 8-bit). */
const BITRATE_BY_RUNG: Record<number, number> = { 1080: 5_000_000, 720: 3_000_000, 480: 1_200_000 };

const SMALLEST_RUNG_PIXELS = 854 * 480;
const MIN_BITRATE = 300_000;

function toEven(value: number): number {
    const whole = Math.floor(value);

    return Math.max(2, whole - (whole % 2));
}

function toRung(name: number, shorter: number, longer: number, isPortrait: boolean): Rung {
    const scaledShorter = toEven(name);
    const scaledLonger = toEven((longer * name) / shorter);
    const width = isPortrait ? scaledShorter : scaledLonger;
    const height = isPortrait ? scaledLonger : scaledShorter;
    const bitrate = BITRATE_BY_RUNG[name] ?? Math.max(MIN_BITRATE, Math.round((BITRATE_BY_RUNG[480]! * width * height) / SMALLEST_RUNG_PIXELS));

    return { name, width, height, bitrate, maxrate: Math.round(bitrate * 1.1), bufsize: bitrate * 2 };
}

/** The one rung of a source below the smallest rung: its own picture size, only rounded down to even. */
function toOwnSizeRung(shorter: number, longer: number, isPortrait: boolean): Rung {
    const rung = toRung(toEven(shorter), shorter, longer, isPortrait);
    const width = toEven(isPortrait ? shorter : longer);
    const height = toEven(isPortrait ? longer : shorter);

    return { ...rung, width, height };
}

export function decideLadder(source: SourceFacts): Ladder {
    const turned = source.rotation === 90 || source.rotation === 270;
    const displayWidth = turned ? source.height : source.width;
    const displayHeight = turned ? source.width : source.height;
    const isPortrait = displayHeight > displayWidth;
    const shorter = Math.min(displayWidth, displayHeight);
    const longer = Math.max(displayWidth, displayHeight);
    const names = RUNG_NAMES.filter((name) => name <= shorter);
    // Below the smallest rung: one rung at the source's own size, so a small clip is still streamable.
    const rungs = names.length > 0 ? names.map((name) => toRung(name, shorter, longer, isPortrait)) : [toOwnSizeRung(shorter, longer, isPortrait)];

    return {
        rungs,
        rotated: source.rotation !== 0,
        frameRateCap: source.frameRate !== null && source.frameRate > MAX_FRAME_RATE ? MAX_FRAME_RATE : null,
    };
}
