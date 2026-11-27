import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, toFilterGraph, type CommandInput } from './ffmpeg-command';
import { toSdrScaleArgs, toToneMap } from './hdr-filters';
import { toFfmpegCommand, toProgressSeconds } from './ffmpeg-run';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { parseFfprobe } from '../media/video-probe';
import { decideLadder, type SourceFacts } from './ladder';
import { loadSourceFacts } from './source-facts';

const SOURCE: SourceFacts = {
    width: 1920,
    height: 1080,
    rotation: 0,
    frameRate: 30,
    isHdr: false,
    colorTransfer: null,
    colorSpace: null,
    pixelFormat: null,
    hasAudio: true,
};

function toInput(overrides: Partial<CommandInput> = {}, source: Partial<SourceFacts> = {}): CommandInput {
    return {
        inputPath: '/in/a.mov',
        outDir: '/out',
        ladder: decideLadder({ ...SOURCE, ...source }),
        hasAudio: true,
        toneMap: null,
        encoder: 'cpu',
        ...overrides,
    };
}

/** The value after a flag, e.g. the filter graph after `-filter_complex`. */
function valueOf(args: string[], flag: string): string {
    return args[args.indexOf(flag) + 1]!;
}

describe('buildFfmpegArgs', () => {
    describe.each(['cpu', 'nvenc'] as const)('%s encoder', (encoder) => {
        it.each([
            ['SDR', null],
            ['HLG', toToneMap('hlg', true)],
            ['PQ without zscale', toToneMap('pq', false)],
        ])('writes fMP4 HLS with aligned keyframes for %s', (_label, toneMap) => {
            const args = buildFfmpegArgs(toInput({ encoder, toneMap }));

            expect(valueOf(args, '-c:v')).toBe(encoder === 'nvenc' ? 'h264_nvenc' : 'libx264');
            expect(valueOf(args, '-f')).toBe('hls');
            expect(valueOf(args, '-hls_segment_type')).toBe('fmp4');
            expect(valueOf(args, '-hls_time')).toBe('4');
            expect(valueOf(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*4)');
            expect(valueOf(args, '-master_pl_name')).toBe('master.m3u8');
            expect(args.at(-1)).toBe('/out/%v/index.m3u8');
            expect(args).toContain('-progress');
        });
    });

    it('decodes on the card for NVENC and on the CPU otherwise', () => {
        expect(buildFfmpegArgs(toInput({ encoder: 'nvenc' }))).toContain('-hwaccel');
        expect(buildFfmpegArgs(toInput({ encoder: 'cpu' }))).not.toContain('-hwaccel');
    });

    it('stops x264 and NVENC from placing keyframes of their own', () => {
        const cpu = buildFfmpegArgs(toInput({ encoder: 'cpu' }));
        const nvenc = buildFfmpegArgs(toInput({ encoder: 'nvenc' }));

        expect(valueOf(cpu, '-sc_threshold')).toBe('0');
        expect(valueOf(nvenc, '-forced-idr')).toBe('1');
        expect(valueOf(nvenc, '-no-scenecut')).toBe('1');
    });

    it('sets a bitrate, ceiling and buffer per rung', () => {
        const args = buildFfmpegArgs(toInput());

        expect(valueOf(args, '-b:v:0')).toBe('5000000');
        expect(valueOf(args, '-b:v:2')).toBe('1200000');
        expect(args).toContain('-maxrate:v:1');
        expect(args).toContain('-bufsize:v:1');
    });

    it('maps one video output per rung and pairs each with its own audio', () => {
        const args = buildFfmpegArgs(toInput());

        expect(valueOf(args, '-var_stream_map')).toBe('v:0,a:0,name:v1080 v:1,a:1,name:v720 v:2,a:2,name:v480');
        expect(args.filter((arg) => arg === '0:a:0')).toHaveLength(3);
        expect(valueOf(args, '-c:a')).toBe('aac');
        expect(valueOf(args, '-ac')).toBe('2');
    });

    it('maps no audio for a video that has none', () => {
        const args = buildFfmpegArgs(toInput({ hasAudio: false }));

        expect(valueOf(args, '-var_stream_map')).toBe('v:0,name:v1080 v:1,name:v720 v:2,name:v480');
        expect(args).not.toContain('0:a:0');
        expect(args).not.toContain('-c:a');
    });

    it('writes a single rung for a small source', () => {
        const args = buildFfmpegArgs(toInput({}, { width: 640, height: 360 }));

        expect(valueOf(args, '-var_stream_map')).toBe('v:0,a:0,name:v360');
    });
});

describe('a background encode', () => {
    it('caps the threads of the decoder, the filter graph and the encoders', () => {
        const args = buildFfmpegArgs(toInput({ threads: 2 }));
        const positions = args.flatMap((arg, index) => (arg === '-threads' ? [index] : []));

        expect(positions.map((index) => args[index + 1])).toEqual(['2', '2']);
        // `-threads` binds to what follows it: one for the input's decoder, one among the output options.
        expect(positions[0]!).toBeLessThan(args.indexOf('-i'));
        expect(positions[1]!).toBeGreaterThan(args.indexOf('-c:v'));
        expect(positions[1]!).toBeLessThan(args.indexOf('-f'));
        expect(valueOf(args, '-filter_complex_threads')).toBe('2');
        expect(args.indexOf('-filter_complex_threads')).toBeLessThan(args.indexOf('-filter_complex'));
    });

    it('adds nothing but the thread caps to the arguments', () => {
        const capped = buildFfmpegArgs(toInput({ threads: 2 }));
        const added = capped.flatMap((arg, index) => (['-threads', '-filter_complex_threads'].includes(arg) ? [index, index + 1] : []));

        expect(capped.filter((_, index) => !added.includes(index))).toEqual(buildFfmpegArgs(toInput()));
    });

    it('starts ffmpeg under nice', () => {
        expect(toFfmpegCommand(['-i', 'a.mov'], 10)).toEqual({ command: 'nice', args: ['-n', '10', 'ffmpeg', '-i', 'a.mov'] });
    });

    it('starts a normal encode as ffmpeg itself', () => {
        expect(toFfmpegCommand(['-i', 'a.mov'])).toEqual({ command: 'ffmpeg', args: ['-i', 'a.mov'] });
    });
});

describe('toFilterGraph', () => {
    it('converts an SDR source that is not BT.709 limited range while it scales', () => {
        const graph = toFilterGraph(toInput({ sdrScaleArgs: toSdrScaleArgs('smpte170m', 'yuvj420p') }));

        expect(graph).toContain('scale=1920:1080:flags=bicubic:in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p');
        expect(toSdrScaleArgs('bt709', 'yuv420p')).toBe('');
        expect(toSdrScaleArgs(null, null)).toBe('');
        expect(toSdrScaleArgs('bt709', 'yuvj420p')).toBe(':in_range=pc:out_color_matrix=bt709:out_range=tv');
    });

    it('scales once to the top rung, then splits and scales down for the others', () => {
        const graph = toFilterGraph(toInput());

        expect(graph).toBe(
            '[0:v:0]fps=30/1,scale=1920:1080:flags=bicubic,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,split=3[c0][c1][c2];' +
                '[c0]null[v0];[c1]scale=1280:720:flags=lanczos[v1];[c2]scale=852:480:flags=lanczos[v2]',
        );
    });

    it('puts the HDR chain once, before the split, not once per rung', () => {
        const toneMap = toToneMap('hlg', true);
        const graph = toFilterGraph(toInput({ toneMap }));

        expect(graph.split(toneMap.chain)).toHaveLength(2);
        expect(graph.indexOf(toneMap.chain)).toBeLessThan(graph.indexOf('split=3'));
    });

    it('does not split a single rung', () => {
        expect(toFilterGraph(toInput({}, { width: 640, height: 360 }))).toContain('null[c0];[c0]null[v0]');
    });

    it('sets a constant frame rate before scaling, capped at 60 fps', () => {
        expect(toFilterGraph(toInput({}, { frameRate: 30 })).startsWith('[0:v:0]fps=30/1,scale=')).toBe(true);
        expect(toFilterGraph(toInput({}, { frameRate: 240 })).startsWith('[0:v:0]fps=60/1,scale=')).toBe(true);
    });

    it('adds no rotation filter: ffmpeg turns a rotated clip upright when it reads it', () => {
        expect(toFilterGraph(toInput({}, { rotation: 90 }))).not.toMatch(/transpose/);
        expect(toFilterGraph(toInput({}, { rotation: 90 }))).toContain('scale=1080:1920');
    });
});

/** What a phone screen recording looked like to ffprobe: audio first, and a nominal rate of 90000 for a video that averages about 25 fps. */
const SCREEN_RECORDING_FFPROBE = {
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.5', bit_rate: '2000000' },
    streams: [
        { index: 0, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 1 },
        {
            index: 1,
            codec_type: 'video',
            codec_name: 'h264',
            width: 720,
            height: 1584,
            pix_fmt: 'yuv420p',
            r_frame_rate: '90000/1',
            avg_frame_rate: '2055000/82297',
        },
    ],
};

async function toRecordingArgs(encoder: 'cpu' | 'nvenc'): Promise<string[]> {
    const noStoredRow = {
        selectFrom: () => ({ selectAll: () => ({ where: () => ({ executeTakeFirst: async () => undefined }) }) }),
    } as unknown as Kysely<Database>;
    const source = await loadSourceFacts(noStoredRow, 'doc', async () => parseFfprobe(SCREEN_RECORDING_FFPROBE));

    return buildFfmpegArgs({ inputPath: '/in/rec.mp4', outDir: '/out', ladder: decideLadder(source), hasAudio: source.hasAudio, toneMap: null, encoder });
}

describe('a variable-rate screen recording with audio as stream 0', () => {
    it.each(['cpu', 'nvenc'] as const)('is encoded at a constant 25 fps on %s, not at its nominal 90000', async (encoder) => {
        const args = await toRecordingArgs(encoder);

        expect(valueOf(args, '-filter_complex').startsWith('[0:v:0]fps=25/1,')).toBe(true);
        expect(valueOf(args, '-r')).toBe('25/1');
        expect(valueOf(args, '-g')).toBe('100');
        expect(args.join(' ')).not.toContain('90000');
    });

    it('maps streams by type: filter outputs and the first audio stream, never an index', async () => {
        const args = await toRecordingArgs('cpu');
        const maps = args.flatMap((arg, index) => (args[index - 1] === '-map' ? [arg] : []));

        expect(maps.length).toBeGreaterThan(0);
        expect(maps.every((map) => /^\[v\d+\]$/.test(map) || map === '0:a:0')).toBe(true);
        expect(maps.some((map) => /^0:\d/.test(map))).toBe(false);
        expect(valueOf(args, '-filter_complex')).toContain('[0:v:0]');
    });
});

describe('a normal clip', () => {
    it('keeps its own rate, and keyframes every 4 s', () => {
        const args = buildFfmpegArgs(toInput());

        expect(valueOf(args, '-r')).toBe('30/1');
        expect(valueOf(args, '-g')).toBe('120');
        expect(valueOf(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*4)');
        expect(valueOf(args, '-hls_time')).toBe('4');
    });

    it('keeps an NTSC rate exact and gives a whole-number GOP', () => {
        const args = buildFfmpegArgs(toInput({}, { frameRate: 30000 / 1001 }));

        expect(valueOf(args, '-r')).toBe('30000/1001');
        expect(valueOf(args, '-g')).toBe('120');
    });
});

describe('toToneMap', () => {
    it('uses zscale when the build has it, and tags the result BT.709', () => {
        const toneMap = toToneMap('hlg', true);

        expect(toneMap.name).toBe('zscale-hable');
        expect(toneMap.chain).toContain('zscale=t=linear');
        expect(toneMap.chain).toContain('tonemap=hable');
        expect(toneMap.chain).toMatch(/setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv$/);
    });

    it.each([
        ['hlg', 'fallback-hlg'],
        ['pq', 'fallback-pq'],
    ] as const)('builds %s from filters every build has when zscale is missing', (kind, name) => {
        const toneMap = toToneMap(kind, false);

        expect(toneMap.name).toBe(name);
        expect(toneMap.chain).not.toContain('zscale');
        expect(toneMap.chain).toContain('tonemap=hable');
        expect(toneMap.chain).toMatch(/setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv$/);
    });

    it('linearises HLG and PQ with different curves', () => {
        expect(toToneMap('hlg', false).chain).not.toEqual(toToneMap('pq', false).chain);
    });
});

describe('toProgressSeconds', () => {
    it('reads the position in seconds', () => {
        expect(toProgressSeconds('out_time_us=2500000')).toBe(2.5);
    });

    it('ignores other lines', () => {
        expect(toProgressSeconds('progress=continue')).toBeNull();
        expect(toProgressSeconds('out_time=00:00:02.500000')).toBeNull();
    });

    it('treats the negative position ffmpeg prints at the start as zero', () => {
        expect(toProgressSeconds('out_time_us=-9223372036854775')).toBe(0);
    });
});
