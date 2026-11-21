import type { Document } from '@reverie/shared';

/**
 * Turns the stored EXIF and video facts into the short strings the info panel shows. Pure, so the odd cases (a missing
 * field, a rotated video, a 1/4000 s shutter) are tested without rendering anything.
 */

type PhotoFacts = NonNullable<Document['photo_metadata']>;
type VideoFacts = NonNullable<Document['video_metadata']>;

export interface MediaFact {
    label: string;
    value: string;
}

const VIDEO_CODEC_NAMES: Record<string, string> = {
    h264: 'H.264',
    hevc: 'HEVC',
    av1: 'AV1',
    vp8: 'VP8',
    vp9: 'VP9',
    mpeg4: 'MPEG-4',
    prores: 'ProRes',
    mpeg2video: 'MPEG-2',
};

const AUDIO_CODEC_NAMES: Record<string, string> = { aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', ac3: 'AC-3', eac3: 'E-AC-3', flac: 'FLAC' };

/** 1.50 as '1.5', 30 as '30': fixed decimals with the trailing zeros dropped. */
function toTrimmed(value: number, decimals: number): string {
    const fixed = value.toFixed(decimals);

    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function toCodecName(codec: string, names: Record<string, string>): string {
    return names[codec] ?? codec.toUpperCase();
}

/** '1/120 s' for a fast shutter, '2 s' or '1.3 s' for a slow one. */
export function formatExposureTime(seconds: number): string {
    if (seconds >= 1) return `${toTrimmed(seconds, 1)} s`;

    return `1/${Math.round(1 / seconds)} s`;
}

/** The camera as a person says it: the model alone when it already starts with the make ('Canon EOS R5'). */
export function formatCamera(make: string | null | undefined, model: string | null | undefined): string | null {
    if (!model) return make || null;

    if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model;

    return `${make} ${model}`;
}

export function formatFocalLength(focalLength: number | null | undefined, equivalent: number | null | undefined): string | null {
    const real = focalLength ? `${toTrimmed(focalLength, focalLength < 10 ? 1 : 0)} mm` : null;
    const full = equivalent ? `${toTrimmed(equivalent, 0)} mm` : null;

    if (real && full && real !== full) return `${real} (${full} equiv.)`;

    return real ?? (full ? `${full} equiv.` : null);
}

/** The clock reading the camera recorded, with the offset it was in when the file says so. The stored time is that reading as if it were UTC, so it is shown in UTC, never shifted to the viewer's zone. */
export function formatCaptureTime(takenAt: string, offset: string | null | undefined): string {
    const clock = new Date(takenAt).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
    });

    return offset ? `${clock} (UTC${offset})` : clock;
}

/** '3:07' or '1:02:07'. */
export function formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');

    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function formatBitrate(bitsPerSecond: number): string {
    return bitsPerSecond >= 1_000_000 ? `${toTrimmed(bitsPerSecond / 1_000_000, 1)} Mbit/s` : `${Math.round(bitsPerSecond / 1000)} kbit/s`;
}

/** The size a player shows: a clip filmed upright is stored sideways and turned 90 or 270 degrees. */
export function formatVideoResolution(video: Pick<VideoFacts, 'width' | 'height' | 'rotation'>): string | null {
    if (!video.width || !video.height) return null;

    const turned = video.rotation === 90 || video.rotation === 270;

    return turned ? `${video.height} × ${video.width}` : `${video.width} × ${video.height}`;
}

function toFact(label: string, value: string | null | undefined): MediaFact[] {
    return value ? [{ label, value }] : [];
}

/** Camera, lens, exposure, focal length and flash; each only when the file carried it. */
export function toPhotoFacts(photo: PhotoFacts | null | undefined): MediaFact[] {
    if (!photo) return [];

    const exposure = [
        photo.iso ? `ISO ${photo.iso}` : null,
        photo.f_number ? `f/${toTrimmed(photo.f_number, 1)}` : null,
        photo.exposure_time ? formatExposureTime(photo.exposure_time) : null,
    ].filter(Boolean);
    const flash = photo.flash_fired == null ? null : photo.flash_fired ? 'Fired' : 'Did not fire';

    return [
        ...toFact('Camera', formatCamera(photo.camera_make, photo.camera_model)),
        ...toFact('Lens', photo.lens_model),
        ...toFact('Exposure', exposure.join(' · ')),
        ...toFact('Focal length', formatFocalLength(photo.focal_length, photo.focal_length_35mm)),
        ...toFact('Flash', flash),
    ];
}

/** Resolution, codec, frame rate, duration, audio and bitrate of a probed video. */
export function toVideoFacts(video: VideoFacts | null | undefined, durationSeconds: number | null | undefined): MediaFact[] {
    if (!video) return [];

    const codec = video.video_codec
        ? [toCodecName(video.video_codec, VIDEO_CODEC_NAMES), video.video_profile, video.is_hdr ? 'HDR' : null].filter(Boolean).join(' · ')
        : null;
    const audio = video.audio_codec ? toCodecName(video.audio_codec, AUDIO_CODEC_NAMES) : 'No audio';

    return [
        ...toFact('Resolution', formatVideoResolution(video)),
        ...toFact('Video', codec),
        ...toFact('Frame rate', video.frame_rate ? `${toTrimmed(video.frame_rate, 2)} fps` : null),
        ...toFact('Duration', durationSeconds ? formatDuration(durationSeconds) : null),
        ...toFact('Audio', audio),
        ...toFact('Bitrate', video.bitrate ? formatBitrate(video.bitrate) : null),
    ];
}
