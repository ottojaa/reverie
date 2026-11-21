import { join } from 'path';
import type { Ladder, Rung } from './ladder';
import { SDR_TAGS_FILTER, type ToneMap } from './hdr-filters';

/** Segment length, and the spacing of the keyframes every rung is forced to have, so a player can switch rung at any segment. */
export const SEGMENT_SECONDS = 4;

export type EncoderKind = 'nvenc' | 'cpu';

export interface CommandInput {
    inputPath: string;
    /** The directory the master playlist and one folder per rung are written to. */
    outDir: string;
    ladder: Ladder;
    hasAudio: boolean;
    /** The chain that turns an HDR source into SDR; null for an SDR source. */
    toneMap: ToneMap | null;
    encoder: EncoderKind;
}

export function toRungDir(rung: Rung): string {
    return `v${rung.name}`;
}

/**
 * The filter graph. The picture is turned upright (ffmpeg does that on its own when it reads the file's rotation),
 * scaled once to the top rung and tone mapped there, so an HDR source is tone mapped once, not once per rung, then split
 * and scaled down to the other rungs.
 */
export function toFilterGraph(input: Pick<CommandInput, 'ladder' | 'toneMap'>): string {
    const { ladder, toneMap } = input;
    const [top, ...lower] = ladder.rungs;

    if (!top) throw new Error('Ladder has no rungs');

    const base = [
        ...(ladder.frameRateCap !== null ? [`fps=${ladder.frameRateCap}`] : []),
        `scale=${top.width}:${top.height}:flags=bicubic`,
        // An SDR source keeps its colours and gets the same tags; an HDR one is converted first.
        ...(toneMap ? [toneMap.chain] : ['format=yuv420p', SDR_TAGS_FILTER]),
    ].join(',');
    const labels = ladder.rungs.map((_, index) => `[c${index}]`).join('');
    const split = ladder.rungs.length > 1 ? `split=${ladder.rungs.length}${labels}` : 'null[c0]';
    const scaled = lower.map((rung, index) => `[c${index + 1}]scale=${rung.width}:${rung.height}:flags=lanczos[v${index + 1}]`);

    return [`[0:v:0]${base},${split}`, '[c0]null[v0]', ...scaled].join(';');
}

function toVideoEncoderArgs(encoder: EncoderKind, rungs: Rung[]): string[] {
    const common = ['-profile:v', 'high', '-pix_fmt', 'yuv420p', '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`];
    const codec =
        encoder === 'nvenc'
            ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-forced-idr', '1', '-no-scenecut', '1']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-sc_threshold', '0'];
    const rates = rungs.flatMap((rung, index) => [
        `-b:v:${index}`,
        String(rung.bitrate),
        `-maxrate:v:${index}`,
        String(rung.maxrate),
        `-bufsize:v:${index}`,
        String(rung.bufsize),
    ]);

    return [...codec, ...common, ...rates];
}

function toVariantMap(rungs: Rung[], hasAudio: boolean): string {
    return rungs.map((rung, index) => `v:${index}${hasAudio ? `,a:${index}` : ''},name:${toRungDir(rung)}`).join(' ');
}

/** The whole ffmpeg argument list: one process reads the source once and writes every rung. */
export function buildFfmpegArgs(input: CommandInput): string[] {
    const { inputPath, outDir, ladder, hasAudio, encoder } = input;
    const videoMaps = ladder.rungs.flatMap((_, index) => ['-map', `[v${index}]`]);
    // Each rung's playlist carries its own audio, so the one source track is mapped once per rung.
    const audioMaps = hasAudio ? ladder.rungs.flatMap(() => ['-map', '0:a:0']) : [];
    const audioArgs = hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : [];

    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-progress',
        'pipe:1',
        '-nostats',
        // The card decodes the (usually HEVC) source; frames come back to system memory by themselves for the CPU filters.
        ...(encoder === 'nvenc' ? ['-hwaccel', 'cuda'] : []),
        '-i',
        inputPath,
        '-filter_complex',
        toFilterGraph(input),
        ...videoMaps,
        ...audioMaps,
        ...toVideoEncoderArgs(encoder, ladder.rungs),
        ...audioArgs,
        '-f',
        'hls',
        '-hls_time',
        String(SEGMENT_SECONDS),
        '-hls_playlist_type',
        'vod',
        '-hls_segment_type',
        'fmp4',
        '-hls_flags',
        'independent_segments',
        '-hls_fmp4_init_filename',
        'init.mp4',
        '-hls_segment_filename',
        join(outDir, '%v', 'seg_%05d.m4s'),
        '-master_pl_name',
        'master.m3u8',
        '-var_stream_map',
        toVariantMap(ladder.rungs, hasAudio),
        join(outDir, '%v', 'index.m3u8'),
    ];
}
