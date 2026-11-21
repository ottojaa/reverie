import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, toFilterGraph, type CommandInput } from './ffmpeg-command';
import { toToneMap } from './hdr-filters';
import { toProgressSeconds } from './ffmpeg-run';
import { decideLadder, type SourceFacts } from './ladder';

const SOURCE: SourceFacts = { width: 1920, height: 1080, rotation: 0, frameRate: 30, isHdr: false, colorTransfer: null, hasAudio: true };

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

describe('toFilterGraph', () => {
    it('scales once to the top rung, then splits and scales down for the others', () => {
        const graph = toFilterGraph(toInput());

        expect(graph).toBe(
            '[0:v:0]scale=1920:1080:flags=bicubic,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,split=3[c0][c1][c2];' +
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

    it('caps the frame rate before scaling when the source is faster than 60 fps', () => {
        expect(toFilterGraph(toInput({}, { frameRate: 240 })).startsWith('[0:v:0]fps=60,scale=')).toBe(true);
    });

    it('adds no rotation filter: ffmpeg turns a rotated clip upright when it reads it', () => {
        expect(toFilterGraph(toInput({}, { rotation: 90 }))).not.toMatch(/transpose/);
        expect(toFilterGraph(toInput({}, { rotation: 90 }))).toContain('scale=1080:1920');
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
