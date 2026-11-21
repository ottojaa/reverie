import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { execFileSync, spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { probeVideoFile } from '../media/video-probe';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { runFfmpeg } from './ffmpeg-run';
import { transcodeDocument, type TranscodeDeps, type TranscodeResult } from './service';

/**
 * Runs the real pipeline (real ffmpeg, the CPU encoder) on two small synthetic clips, then reads what came out with ffprobe.
 * The clips are generated with ffmpeg's test sources, so no real footage is in the repo. Skipped only when ffmpeg is not installed.
 */

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const hasZscale = hasFfmpeg && spawnSync('ffmpeg', ['-hide_banner', '-filters']).stdout.toString().includes(' zscale ');

const CLIP_SECONDS = 10;

function ffmpeg(args: string[]): void {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** H.264 SDR 1080p with stereo audio. */
function makeSdrClip(path: string): void {
    ffmpeg([
        ...['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${CLIP_SECONDS}`],
        ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`],
        ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path],
    ]);
}

/** HEVC 10-bit HLG (BT.2020) 1920x1080, tagged to be turned 90 degrees clockwise when played, like a phone clip held upright. */
function makeRotatedHlgClip(path: string): void {
    const unrotated = path.replace('.mp4', '-unrotated.mp4');
    const hlg = 'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv';

    ffmpeg([
        ...['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${CLIP_SECONDS}`],
        ...['-f', 'lavfi', '-i', `sine=frequency=330:duration=${CLIP_SECONDS}`],
        ...['-vf', `format=yuv420p10le,${hlg}`, '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le'],
        ...[
            '-x265-params',
            'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
            '-tag:v',
            'hvc1',
            '-c:a',
            'aac',
            '-shortest',
            unrotated,
        ],
    ]);
    ffmpeg(['-display_rotation', '90', '-i', unrotated, '-c', 'copy', path]);
}

/**
 * A phone screen recording as ffprobe reported the failing ones: audio is stream 0, the video is stream 1 with a 90 kHz
 * timebase and frames only where the screen changed (about 25 per second, unevenly spaced, some one tick apart).
 */
function makeScreenRecordingClip(path: string): void {
    ffmpeg([
        ...['-f', 'lavfi', '-i', 'testsrc2=size=720x1584:rate=1000:duration=5.5'],
        ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5.5:sample_rate=48000'],
        ...['-vf', "select='gt(random(1),0.975)',settb=1/90000,setpts='floor(PTS*0.9+random(2)*40)'", '-fps_mode', 'passthrough'],
        ...['-video_track_timescale', '90000', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1'],
        ...['-map', '1:a', '-map', '0:v', path],
    ]);
}

/** The gaps, in seconds, between the video frames of a playlist, in display order. */
function probeFrameGaps(playlist: string): number[] {
    const out = execFileSync('ffprobe', [
        ...['-v', 'error', '-allowed_extensions', 'ALL', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', playlist],
    ]).toString();
    const times = out
        .trim()
        .split('\n')
        .map(Number)
        .sort((a, b) => a - b);

    return times.slice(1).map((time, index) => Math.round((time - times[index]!) * 10_000) / 10_000);
}

interface ProbedStream {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    channels?: number;
    color_transfer?: string;
    color_primaries?: string;
    color_space?: string;
    color_range?: string;
    side_data_list?: Array<{ side_data_type: string }>;
}

function probeStreams(playlist: string): ProbedStream[] {
    const out = execFileSync('ffprobe', ['-v', 'error', '-allowed_extensions', 'ALL', '-show_streams', '-of', 'json', playlist]).toString();

    return (JSON.parse(out) as { streams: ProbedStream[] }).streams;
}

/** The times, in seconds, of the video keyframes of a playlist. */
function probeKeyframes(playlist: string): number[] {
    const out = execFileSync('ffprobe', [
        ...['-v', 'error', '-allowed_extensions', 'ALL', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', playlist],
    ]).toString();

    return out
        .trim()
        .split('\n')
        .map((line) => line.split(','))
        .filter(([, flags]) => flags?.includes('K'))
        .map(([time]) => Math.round(Number(time) * 1000) / 1000);
}

function toSegmentDurations(playlist: string): number[] {
    return [...playlist.matchAll(/#EXTINF:([\d.]+),/g)].map((match) => Number(match[1]));
}

describeDb('real transcode of synthetic clips', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let workDir: string;
    const stored = new Map<string, Buffer>();
    const originals = new Map<string, string>();

    /** Storage that keeps the renditions in memory and hands out the real clip as the original. */
    const storage: TranscodeDeps['storage'] = {
        writeFile: async (path, buffer) => void stored.set(path, buffer),
        fileExists: async (path) => originals.has(path) || stored.has(path),
        deleteFile: async (path) => void stored.delete(path),
        getLocalFilePath: async (path) => ({ path: originals.get(path)!, cleanup: async () => {} }),
    };
    const deps = (): TranscodeDeps => ({
        db,
        storage,
        capabilities: async () => ({ nvenc: false, zscale: hasZscale }),
        runFfmpeg,
        probe: probeVideoFile,
    });

    beforeAll(async () => {
        if (!hasFfmpeg) return;

        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
        workDir = await mkdtemp(join(tmpdir(), 'reverie-real-transcode-'));
    }, 60_000);
    afterAll(async () => {
        await database?.close();

        if (workDir) await rm(workDir, { recursive: true, force: true });
    });

    /** Transcodes a clip through the real pipeline, writes the stored files to disk, and returns where. */
    async function transcodeClip(name: string, make: (path: string) => void): Promise<{ dir: string; result: TranscodeResult; hash: string }> {
        const clip = join(workDir, `${name}.mp4`);
        const hash = `hash-${name}`;

        make(clip);
        originals.set(`/files/${name}.mp4`, clip);

        const id = await seedDocument(db, { userId, name: `${name}.mp4`, mime: 'video/mp4', hash });

        await db
            .updateTable('documents')
            .set({ transcode_status: 'pending', duration_seconds: CLIP_SECONDS, file_path: `/files/${name}.mp4` })
            .where('id', '=', id)
            .execute();

        const result = await transcodeDocument(deps(), id, async () => {});
        const dir = join(workDir, `out-${name}`);

        for (const [path, buffer] of stored) {
            if (!path.startsWith(`transcode/${hash}/`)) continue;

            const target = join(dir, path.slice(`transcode/${hash}/`.length));

            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, buffer);
        }

        console.log(
            `[transcode-timing] ${name}: ${result.wallMs} ms for ${CLIP_SECONDS} s of video, ${result.totalBytes} bytes, ${result.toneMap ?? 'no tone map'}`,
        );

        return { dir, result, hash };
    }

    /** What every rung of every clip has to satisfy, whatever the source was. */
    async function expectWellFormedSet(dir: string, sizes: string[]): Promise<void> {
        const master = await readFile(join(dir, 'master.m3u8'), 'utf8');

        // Relative URLs only, so the whole folder can be served from anywhere.
        expect([...master.matchAll(/^(?!#)(.+)$/gm)].map((match) => match[1])).toEqual(
            ['v1080/index.m3u8', 'v720/index.m3u8', 'v480/index.m3u8'].slice(0, sizes.length),
        );
        expect([...master.matchAll(/RESOLUTION=(\d+x\d+)/g)].map((match) => match[1])).toEqual(sizes);
        expect(master).not.toMatch(/https?:|URI="\//);

        const keyframes: number[][] = [];

        for (const [index, size] of sizes.entries()) {
            const rung = ['v1080', 'v720', 'v480'][index]!;
            const playlist = join(dir, rung, 'index.m3u8');
            const text = await readFile(playlist, 'utf8');
            const durations = toSegmentDurations(text);
            const [width, height] = size.split('x').map(Number);
            const video = probeStreams(playlist).find((stream) => stream.codec_type === 'video')!;
            const audio = probeStreams(playlist).find((stream) => stream.codec_type === 'audio')!;

            // fMP4 segments of 4 seconds (the last one holds what is left).
            // ffmpeg 8 numbers the init file (init_0.mp4), older builds do not, so the name is read from the playlist.
            const initFile = /#EXT-X-MAP:URI="(init(?:_\d+)?\.mp4)"/.exec(text)?.[1];

            expect(initFile).toBeDefined();
            expect(await stat(join(dir, rung, initFile!))).toBeTruthy();
            expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
            expect(durations.slice(0, -1).every((seconds) => Math.abs(seconds - 4) < 0.1)).toBe(true);
            expect(durations.at(-1)!).toBeLessThanOrEqual(4.1);
            expect(durations.reduce((sum, seconds) => sum + seconds, 0)).toBeCloseTo(CLIP_SECONDS, 0);

            // Upright, the right size, BT.709, 8-bit, no rotation left to apply.
            expect({ w: video.width, h: video.height }).toEqual({ w: width, h: height });
            expect(video).toMatchObject({
                codec_name: 'h264',
                pix_fmt: 'yuv420p',
                color_transfer: 'bt709',
                color_primaries: 'bt709',
                color_space: 'bt709',
                color_range: 'tv',
            });
            expect(video.side_data_list ?? []).toEqual([]);
            expect(audio).toMatchObject({ codec_name: 'aac', channels: 2 });

            keyframes.push(probeKeyframes(playlist));
        }

        // Aligned keyframes: every rung has them at the same moments, and one at the start of every segment.
        for (const times of keyframes) expect(times).toEqual(keyframes[0]);

        // The container starts its clock a few hundredths of a second in (audio priming), the same on every rung.
        const first = keyframes[0]!;

        expect(first).toHaveLength(3);
        expect(first[0]!).toBeLessThan(0.1);
        expect(first.map((time) => Math.round((time - first[0]!) * 1000) / 1000)).toEqual([0, 4, 8]);
    }

    it.skipIf(!hasFfmpeg)(
        'turns an H.264 SDR 1080p clip into three aligned, BT.709 rungs',
        async () => {
            const { dir, result } = await transcodeClip('sdr1080', makeSdrClip);

            expect(result).toMatchObject({ encoder: 'cpu', toneMap: null, shared: false });

            await expectWellFormedSet(dir, ['1920x1080', '1280x720', '852x480']);
        },
        300_000,
    );

    it.skipIf(!hasFfmpeg)(
        'turns an HEVC 10-bit HLG clip rotated 90 degrees into upright SDR BT.709 rungs',
        async () => {
            // The source really is what the brief says: coded landscape, rotated, HLG.
            const source = join(workDir, 'hlg-check.mp4');

            makeRotatedHlgClip(source);

            const [probed] = probeStreams(source);

            expect(probed).toMatchObject({ codec_name: 'hevc', pix_fmt: 'yuv420p10le', color_transfer: 'arib-std-b67', width: 1920, height: 1080 });
            expect(probed!.side_data_list?.map((data) => data.side_data_type)).toContain('Display Matrix');

            const { dir, result } = await transcodeClip('hlg-rotated', makeRotatedHlgClip);

            expect(result.toneMap).toBe(hasZscale ? 'zscale-hable' : 'fallback-hlg');

            await expectWellFormedSet(dir, ['1080x1920', '720x1280', '480x852']);
        },
        300_000,
    );

    it.skipIf(!hasFfmpeg)(
        'turns a variable-rate screen recording with audio first into constant 25 fps rungs with keyframes every 4 s',
        async () => {
            const source = join(workDir, 'screen-check.mp4');

            makeScreenRecordingClip(source);

            const [first, second] = probeStreams(source);

            // The clip is shaped like the failing recordings: audio is stream 0, and the video's timebase is 1/90000.
            expect([first!.codec_type, second!.codec_type]).toEqual(['audio', 'video']);

            const { dir } = await transcodeClip('screen-recording', makeScreenRecordingClip);

            for (const rung of ['v720', 'v480']) {
                const playlist = join(dir, rung, 'index.m3u8');
                const video = probeStreams(playlist).find((stream) => stream.codec_type === 'video')!;
                const gaps = probeFrameGaps(playlist);
                const keyframes = probeKeyframes(playlist);

                expect(
                    probeStreams(playlist)
                        .map((stream) => stream.codec_type)
                        .sort(),
                ).toEqual(['audio', 'video']);
                expect(video.height! / video.width!).toBeCloseTo(1584 / 720, 1);
                // Constant 25 fps: every gap is one frame, within a hundredth of a second of 1/25.
                expect(gaps.length).toBeGreaterThan(100);
                expect(gaps.every((gap) => Math.abs(gap - 0.04) < 0.01)).toBe(true);
                // Keyframes at the start and at 4 s.
                expect(keyframes).toHaveLength(2);
                expect(keyframes[1]! - keyframes[0]!).toBeCloseTo(4, 1);
            }
        },
        300_000,
    );
});
