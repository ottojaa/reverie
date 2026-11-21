import { execFile } from 'child_process';

/**
 * A video's technical facts, from one `ffprobe` run. `parseFfprobe` is a pure function of ffprobe's JSON, so it is
 * tested on recorded output; `probeVideoFile` runs ffprobe on a stored file (by path: videos can be many GB).
 */

/** The file extension ffprobe and ffmpeg want on a temp copy of a stored video (they sniff by content, but a name helps). */
const VIDEO_MIME_TO_EXT: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
};

export function toVideoExtension(mimeType: string): string {
    return VIDEO_MIME_TO_EXT[mimeType] ?? '';
}

/** ffprobe ran but the file is not something it can read (it exited non-zero, or printed no JSON): reading it again will not help. */
export class VideoUnreadableError extends Error {}

const PROBE_TIMEOUT_MS = 60_000;
const PROBE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Transfer functions that mean high dynamic range: PQ (HDR10, Dolby Vision) and HLG. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

/** Dates before this are a container's "never set" value (1904 and 1970 epochs, zero dates), not a recording time. */
const EARLIEST_PLAUSIBLE_RECORDING = Date.UTC(1990, 0, 1);

export interface VideoFacts {
    container: string | null;
    videoCodec: string | null;
    videoProfile: string | null;
    pixelFormat: string | null;
    audioCodec: string | null;
    /** Whole-file bits per second. */
    bitrate: number | null;
    /** The coded size; apply `rotation` for the displayed size. */
    width: number | null;
    height: number | null;
    frameRate: number | null;
    /** Degrees clockwise a player turns the picture: 0, 90, 180 or 270. */
    rotation: number;
    colorTransfer: string | null;
    colorPrimaries: string | null;
    colorSpace: string | null;
    isHdr: boolean;
    /** The container's creation time (a UTC instant). */
    creationTime: Date | null;
}

export interface VideoCapture {
    /** The recording clock reading as if it were UTC; the instant is this minus `takenAtOffset`. */
    takenAt: Date | null;
    /** '+03:00' when the file's own tags carry the local offset; '+00:00' when only the UTC creation time is known. */
    takenAtOffset: string | null;
    latitude: number | null;
    longitude: number | null;
}

export interface VideoProbe {
    durationSeconds: number | null;
    video: VideoFacts;
    capture: VideoCapture;
}

type Tags = Record<string, unknown>;

interface FfprobeStream {
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    color_transfer?: string;
    color_primaries?: string;
    color_space?: string;
    disposition?: { attached_pic?: number };
    tags?: Tags;
    side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface FfprobeOutput {
    format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Tags };
    streams?: FfprobeStream[];
}

function toText(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const text = value.trim();

    // ffprobe prints "unknown" for colour fields the stream does not set.
    return text === '' || text === 'unknown' ? null : text.slice(0, 100);
}

function toPositiveNumber(value: unknown): number | null {
    const number = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;

    return Number.isFinite(number) && number > 0 ? number : null;
}

function toWholeNumber(value: unknown): number | null {
    const number = toPositiveNumber(value);

    return number === null ? null : Math.round(number);
}

/** '30000/1001' as 29.97; null for '0/0'. */
function toFrameRate(value: unknown): number | null {
    if (typeof value !== 'string') return null;

    const [numerator, denominator] = value.split('/').map(Number);

    if (numerator === undefined || denominator === undefined || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;

    return numerator > 0 ? numerator / denominator : null;
}

/** The container name a person would recognise: format_name lists a family ('mov,mp4,m4a,3gp,3g2,mj2'), the brand picks the member. */
function toContainer(formatName: string | undefined, brand: unknown): string | null {
    const family = toText(formatName);

    if (!family) return null;

    if (!family.startsWith('mov,')) return family.split(',')[0] ?? null;

    const majorBrand = typeof brand === 'string' ? brand.trim().toLowerCase() : '';

    if (majorBrand === 'qt') return 'mov';

    if (majorBrand.startsWith('3g')) return '3gp';

    if (majorBrand === 'm4v') return 'm4v';

    return 'mp4';
}

/**
 * Degrees clockwise a player must turn the picture. ffprobe's display-matrix `rotation` counts counter-clockwise
 * (an iPhone portrait clip reads -90), the legacy `rotate` tag counts clockwise; both are folded to 0/90/180/270.
 */
function toRotation(stream: FfprobeStream): number {
    const matrix = stream.side_data_list?.find((entry) => typeof entry.rotation === 'number');
    const clockwise = matrix?.rotation !== undefined ? -matrix.rotation : Number.parseFloat(String(stream.tags?.['rotate'] ?? '0'));

    if (!Number.isFinite(clockwise)) return 0;

    return (((Math.round(clockwise / 90) * 90) % 360) + 360) % 360;
}

function toPlausibleDate(date: Date): Date | null {
    return Number.isNaN(date.getTime()) || date.getTime() < EARLIEST_PLAUSIBLE_RECORDING ? null : date;
}

function toUtcInstant(value: unknown): Date | null {
    return typeof value === 'string' ? toPlausibleDate(new Date(value)) : null;
}

const LOCAL_CREATION_DATE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/;

/** An iPhone's `com.apple.quicktime.creationdate` ('2024-05-01T14:03:22+0300'): the local clock plus its offset. */
function toLocalCreation(value: unknown): { takenAt: Date; offset: string } | null {
    const match = typeof value === 'string' ? LOCAL_CREATION_DATE.exec(value.trim()) : null;

    if (!match) return null;

    const takenAt = toPlausibleDate(new Date(`${match[1]}Z`));

    return takenAt ? { takenAt, offset: `${match[2]}${match[3]}:${match[4]}` } : null;
}

const ISO_6709 = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/;

/** The latitude and longitude of an ISO 6709 string ('+60.1699+024.9384+012.000/'); null when absent or out of range. */
export function parseIso6709(value: unknown): { latitude: number; longitude: number } | null {
    const match = typeof value === 'string' ? ISO_6709.exec(value.trim()) : null;

    if (!match) return null;

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);

    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    // 0,0 is what a phone writes when it had no fix, not a place in the Gulf of Guinea.
    return latitude === 0 && longitude === 0 ? null : { latitude, longitude };
}

function readCapture(tags: Tags, creationTime: Date | null): VideoCapture {
    const place = parseIso6709(tags['com.apple.quicktime.location.ISO6709'] ?? tags['location']);
    const local = toLocalCreation(tags['com.apple.quicktime.creationdate']);
    const capture = local
        ? { takenAt: local.takenAt, takenAtOffset: local.offset }
        : { takenAt: creationTime, takenAtOffset: creationTime ? '+00:00' : null };

    return { ...capture, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null };
}

export function parseFfprobe(output: unknown): VideoProbe {
    const { format, streams }: FfprobeOutput = output && typeof output === 'object' ? (output as FfprobeOutput) : {};
    const video = streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const audio = streams?.find((stream) => stream.codec_type === 'audio');
    // Phones write the location and creation tags on the container; some muxers put them on the video stream instead.
    const tags: Tags = { ...video?.tags, ...format?.tags };
    const creationTime = toUtcInstant(format?.tags?.['creation_time'] ?? video?.tags?.['creation_time']);
    const colorTransfer = toText(video?.color_transfer);

    return {
        durationSeconds: toPositiveNumber(format?.duration),
        video: {
            container: toContainer(format?.format_name, format?.tags?.['major_brand']),
            videoCodec: toText(video?.codec_name),
            videoProfile: toText(video?.profile),
            pixelFormat: toText(video?.pix_fmt),
            audioCodec: toText(audio?.codec_name),
            bitrate: toWholeNumber(format?.bit_rate),
            width: toWholeNumber(video?.width),
            height: toWholeNumber(video?.height),
            frameRate: toFrameRate(video?.avg_frame_rate) ?? toFrameRate(video?.r_frame_rate),
            rotation: video ? toRotation(video) : 0,
            colorTransfer,
            colorPrimaries: toText(video?.color_primaries),
            colorSpace: toText(video?.color_space),
            isHdr: colorTransfer !== null && HDR_TRANSFERS.has(colorTransfer),
            creationTime,
        },
        capture: readCapture(tags, creationTime),
    };
}

/**
 * Probe a stored video file. Rejects with `VideoUnreadableError` when the file is not readable as a video, and with the
 * raw error when ffprobe itself could not run (missing binary, timeout): those are worth retrying.
 */
export function probeVideoFile(path: string): Promise<VideoProbe> {
    return new Promise((resolve, reject) => {
        execFile(
            'ffprobe',
            ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', path],
            { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_OUTPUT_BYTES },
            (error, stdout) => {
                // A numeric code is ffprobe's own exit status; a string code ('ENOENT') or `killed` means it never ran to the end.
                if (error) return reject(typeof error.code === 'number' ? new VideoUnreadableError('ffprobe could not read the file') : error);

                try {
                    resolve(parseFfprobe(JSON.parse(stdout)));
                } catch {
                    reject(new VideoUnreadableError('ffprobe printed unreadable output'));
                }
            },
        );
    });
}
