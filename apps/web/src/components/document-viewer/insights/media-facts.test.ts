import type { Document } from '@reverie/shared';
import { describe, expect, it } from 'vitest';
import {
    formatBitrate,
    formatCamera,
    formatCaptureTime,
    formatDuration,
    formatExposureTime,
    formatFocalLength,
    toPhotoFacts,
    toVideoFacts,
} from './media-facts';

type Photo = NonNullable<Document['photo_metadata']>;
type Video = NonNullable<Document['video_metadata']>;

const BARE_PHOTO: Photo = { latitude: null, longitude: null, city: null, country: null, taken_at: null };
const BARE_VIDEO: Video = {
    container: null,
    video_codec: null,
    video_profile: null,
    audio_codec: null,
    bitrate: null,
    width: null,
    height: null,
    frame_rate: null,
    rotation: null,
    color_transfer: null,
    is_hdr: false,
    creation_time: null,
};

describe('photo facts', () => {
    it('lists camera, lens, exposure, focal length and flash from a full set of EXIF', () => {
        const facts = toPhotoFacts({
            ...BARE_PHOTO,
            camera_make: 'Apple',
            camera_model: 'iPhone 15',
            lens_model: 'iPhone 15 back camera 6.86mm f/1.78',
            iso: 80,
            f_number: 1.78,
            exposure_time: 1 / 120,
            focal_length: 6.86,
            focal_length_35mm: 24,
            flash_fired: false,
        });

        expect(facts).toEqual([
            { label: 'Camera', value: 'Apple iPhone 15' },
            { label: 'Lens', value: 'iPhone 15 back camera 6.86mm f/1.78' },
            { label: 'Exposure', value: 'ISO 80 · f/1.8 · 1/120 s' },
            { label: 'Focal length', value: '6.9 mm (24 mm equiv.)' },
            { label: 'Flash', value: 'Did not fire' },
        ]);
    });

    it('shows nothing for a photo with no EXIF, and only the fields it has otherwise', () => {
        expect(toPhotoFacts(null)).toEqual([]);
        expect(toPhotoFacts(undefined)).toEqual([]);
        expect(toPhotoFacts(BARE_PHOTO)).toEqual([]);
        expect(toPhotoFacts({ ...BARE_PHOTO, iso: 400, flash_fired: true })).toEqual([
            { label: 'Exposure', value: 'ISO 400' },
            { label: 'Flash', value: 'Fired' },
        ]);
    });

    it('keeps the model alone when it already starts with the make, and either one alone', () => {
        expect(formatCamera('Canon', 'Canon EOS R5')).toBe('Canon EOS R5');
        expect(formatCamera('Canon', null)).toBe('Canon');
        expect(formatCamera(null, 'X100V')).toBe('X100V');
        expect(formatCamera(null, null)).toBeNull();
    });

    it('writes shutter speeds the way a camera does', () => {
        expect(formatExposureTime(1 / 4000)).toBe('1/4000 s');
        expect(formatExposureTime(0.5)).toBe('1/2 s');
        expect(formatExposureTime(2)).toBe('2 s');
        expect(formatExposureTime(1.3)).toBe('1.3 s');
    });

    it('writes the real and the 35mm-equivalent focal length once when they agree', () => {
        expect(formatFocalLength(50, 50)).toBe('50 mm');
        expect(formatFocalLength(23, 35)).toBe('23 mm (35 mm equiv.)');
        expect(formatFocalLength(null, 24)).toBe('24 mm equiv.');
        expect(formatFocalLength(null, null)).toBeNull();
    });

    it('shows the capture clock as recorded, not shifted to the viewer, with its offset when known', () => {
        const taken = '2024-05-01T14:03:22.000Z';

        expect(formatCaptureTime(taken, '+03:00')).toMatch(/(2:03 ?pm|14:03).*\(UTC\+03:00\)$/i);
        expect(formatCaptureTime(taken, null)).not.toContain('UTC+');
    });
});

describe('video facts', () => {
    it('lists resolution, codec, frame rate, duration, audio and bitrate', () => {
        const facts = toVideoFacts(
            {
                ...BARE_VIDEO,
                width: 3840,
                height: 2160,
                rotation: 0,
                video_codec: 'hevc',
                video_profile: 'Main 10',
                is_hdr: true,
                frame_rate: 29.97,
                audio_codec: 'aac',
                bitrate: 42_500_000,
            },
            3727,
        );

        expect(facts).toEqual([
            { label: 'Resolution', value: '3840 × 2160' },
            { label: 'Video', value: 'HEVC · Main 10 · HDR' },
            { label: 'Frame rate', value: '29.97 fps' },
            { label: 'Duration', value: '1:02:07' },
            { label: 'Audio', value: 'AAC' },
            { label: 'Bitrate', value: '42.5 Mbit/s' },
        ]);
    });

    it('shows the size a player shows for a clip stored sideways', () => {
        expect(toVideoFacts({ ...BARE_VIDEO, width: 1920, height: 1080, rotation: 90 }, null)[0]).toEqual({ label: 'Resolution', value: '1080 × 1920' });
        expect(toVideoFacts({ ...BARE_VIDEO, width: 1920, height: 1080, rotation: 180 }, null)[0]).toEqual({ label: 'Resolution', value: '1920 × 1080' });
    });

    it('says there is no audio, and leaves out what ffprobe could not tell', () => {
        expect(toVideoFacts({ ...BARE_VIDEO, video_codec: 'h264', frame_rate: 30 }, 5)).toEqual([
            { label: 'Video', value: 'H.264' },
            { label: 'Frame rate', value: '30 fps' },
            { label: 'Duration', value: '0:05' },
            { label: 'Audio', value: 'No audio' },
        ]);
    });

    it('shows nothing for a video that has not been probed', () => {
        expect(toVideoFacts(null, 12)).toEqual([]);
        expect(toVideoFacts(undefined, 12)).toEqual([]);
    });

    it('formats durations and bitrates at their edges', () => {
        expect(formatDuration(59.6)).toBe('1:00');
        expect(formatDuration(0.4)).toBe('0:00');
        expect(formatBitrate(800_000)).toBe('800 kbit/s');
        expect(formatBitrate(8_000_000)).toBe('8 Mbit/s');
    });
});
