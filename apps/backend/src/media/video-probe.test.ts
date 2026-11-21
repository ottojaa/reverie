import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseFfprobe, parseIso6709 } from './video-probe';

/** ffprobe's JSON for three real clips made with ffmpeg: see ./fixtures. */
function load(name: string): unknown {
    return JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.ffprobe.json`), 'utf8'));
}

describe('parseFfprobe: H.264 MP4', () => {
    const probe = parseFfprobe(load('h264-mp4'));

    it('reads the container, codecs, size, rate and bitrate', () => {
        expect(probe.durationSeconds).toBe(2);
        expect(probe.video).toMatchObject({
            container: 'mp4',
            videoCodec: 'h264',
            videoProfile: 'High',
            pixelFormat: 'yuv420p',
            audioCodec: 'aac',
            bitrate: 174460,
            width: 640,
            height: 360,
            frameRate: 30,
            rotation: 0,
            isHdr: false,
            colorTransfer: null,
        });
    });

    it('takes the UTC creation time as the capture time, with a zero offset, and has no place', () => {
        expect(probe.video.creationTime?.toISOString()).toBe('2024-05-01T11:03:22.000Z');
        expect(probe.capture).toEqual({ takenAt: new Date('2024-05-01T11:03:22.000Z'), takenAtOffset: '+00:00', latitude: null, longitude: null });
    });
});

describe('parseFfprobe: HEVC MOV with rotation and GPS', () => {
    const probe = parseFfprobe(load('hevc-mov-rotated-gps'));

    it('reads the HEVC profile, the 29.97 frame rate and the QuickTime container', () => {
        expect(probe.video).toMatchObject({
            container: 'mov',
            videoCodec: 'hevc',
            videoProfile: 'Main 10',
            pixelFormat: 'yuv420p10le',
            frameRate: 30000 / 1001,
            audioCodec: 'aac',
        });
    });

    it('flags HLG as HDR and keeps the colour fields', () => {
        expect(probe.video).toMatchObject({ isHdr: true, colorTransfer: 'arib-std-b67', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc' });
    });

    it("turns ffprobe's counter-clockwise display matrix (90) into the 270 degrees clockwise a player applies", () => {
        expect(probe.video.rotation).toBe(270);
    });

    it('reads the location, and the local capture clock with its offset rather than the UTC creation time', () => {
        expect(probe.capture.latitude).toBe(60.1699);
        expect(probe.capture.longitude).toBe(24.9384);
        expect(probe.capture.takenAt?.toISOString()).toBe('2024-05-01T14:03:22.000Z');
        expect(probe.capture.takenAtOffset).toBe('+03:00');
    });
});

describe('parseFfprobe: no audio', () => {
    const probe = parseFfprobe(load('h264-mp4-no-audio'));

    it('has no audio codec and still reads the video', () => {
        expect(probe.video).toMatchObject({ audioCodec: null, videoCodec: 'h264', width: 320, height: 240 });
    });

    it('has no capture time or place when the tags carry none', () => {
        expect(probe.capture).toEqual({ takenAt: null, takenAtOffset: null, latitude: null, longitude: null });
        expect(probe.video.creationTime).toBeNull();
    });
});

describe('parseFfprobe: odd input', () => {
    it('returns empty facts for output with no streams or for something that is not an object', () => {
        for (const input of [{}, null, 'text', { format: {}, streams: [] }]) {
            const probe = parseFfprobe(input);

            expect(probe.durationSeconds).toBeNull();
            expect(probe.video).toMatchObject({ videoCodec: null, width: null, frameRate: null, rotation: 0, isHdr: false });
        }
    });

    it('reads the legacy clockwise rotate tag and normalises negative angles', () => {
        const rotated = (tags: Record<string, string>, matrix?: number) =>
            parseFfprobe({
                streams: [
                    {
                        codec_type: 'video',
                        tags,
                        ...(matrix === undefined ? {} : { side_data_list: [{ side_data_type: 'Display Matrix', rotation: matrix }] }),
                    },
                ],
            }).video.rotation;

        expect(rotated({ rotate: '90' })).toBe(90);
        expect(rotated({}, -90)).toBe(90);
        expect(rotated({}, 180)).toBe(180);
        expect(rotated({}, -180)).toBe(180);
        expect(rotated({}, 0)).toBe(0);
    });

    it('ignores a never-set creation time and cover-art streams', () => {
        const probe = parseFfprobe({
            format: { tags: { creation_time: '1970-01-01T00:00:00.000000Z' } },
            streams: [
                { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
                { codec_type: 'video', codec_name: 'h264', color_transfer: 'unknown' },
            ],
        });

        expect(probe.capture.takenAt).toBeNull();
        expect(probe.video).toMatchObject({ videoCodec: 'h264', colorTransfer: null });
    });

    it('reads tags written on the video stream instead of the container', () => {
        const probe = parseFfprobe({ streams: [{ codec_type: 'video', tags: { creation_time: '2022-02-02T10:00:00Z', location: '-33.8688+151.2093/' } }] });

        expect(probe.capture).toMatchObject({ takenAt: new Date('2022-02-02T10:00:00Z'), latitude: -33.8688, longitude: 151.2093 });
    });

    it('names the MOV-family containers from the major brand', () => {
        const container = (brand: string) => parseFfprobe({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: brand } } }).video.container;

        expect([container('qt  '), container('3gp4'), container('M4V '), container('isom')]).toEqual(['mov', '3gp', 'm4v', 'mp4']);
        expect(parseFfprobe({ format: { format_name: 'matroska,webm' } }).video.container).toBe('matroska');
    });
});

describe('parseIso6709', () => {
    it('reads signed decimal degrees with an optional altitude', () => {
        expect(parseIso6709('+60.1699+024.9384+012.000/')).toEqual({ latitude: 60.1699, longitude: 24.9384 });
        expect(parseIso6709('-33.8688-070.6693/')).toEqual({ latitude: -33.8688, longitude: -70.6693 });
    });

    it('rejects garbage, out-of-range values and the no-fix 0,0', () => {
        expect(parseIso6709('nowhere')).toBeNull();
        expect(parseIso6709('+95.0000+024.0000/')).toBeNull();
        expect(parseIso6709('+00.0000+000.0000/')).toBeNull();
        expect(parseIso6709(undefined)).toBeNull();
    });
});
