/**
 * ffmpeg filter chains that turn an HDR picture (HLG or PQ, BT.2020 primaries) into SDR with BT.709 tags.
 *
 * Two chains, chosen by what this ffmpeg build has:
 *  - `zscale` (libzimg): the proper path. Linearise, convert the primaries, tone map, then convert to BT.709.
 *  - without it, the same steps built from filters every build has (`scale`, `lutrgb`, `colorchannelmixer`,
 *    `tonemap`). `tonemap` itself cannot read HLG or PQ, so the transfer curve is undone by a 16-bit lookup table, which
 *    is approximate in the darkest shades but keeps the picture's brightness and colour right.
 *
 * Every chain ends in `setparams`: ffmpeg's `-color_*` output options do not replace the tags a frame carries into the
 * muxer, so the tags are set on the frames themselves.
 */

export type HdrKind = 'hlg' | 'pq';

export type ToneMapName = 'zscale-hable' | 'fallback-hlg' | 'fallback-pq';

export interface ToneMap {
    name: ToneMapName;
    /** Comma-joined filters, from the HDR frame to 8-bit BT.709 4:2:0. */
    chain: string;
}

const BT709_TAGS = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** The tags every rung carries, HDR or not. */
export const SDR_TAGS_FILTER = BT709_TAGS;

export function toHdrKind(colorTransfer: string | null): HdrKind | null {
    if (colorTransfer === 'arib-std-b67') return 'hlg';

    if (colorTransfer === 'smpte2084') return 'pq';

    return null;
}

/** BT.2020 to BT.709 primaries as a linear-light matrix. */
const BT2020_TO_BT709 = [
    [1.6605, -0.5876, -0.0728],
    [-0.1246, 1.1329, -0.0083],
    [-0.0182, -0.1006, 1.1187],
] as const;

/** `colorchannelmixer` takes coefficients between -2 and 2 only, so a larger gain is applied in steps of at most 2. */
function toGainStages(gain: number): string[] {
    const stages: string[] = [];
    let left = gain;

    while (left > 2) {
        stages.push('colorchannelmixer=rr=2:gg=2:bb=2');
        left /= 2;
    }

    stages.push(`colorchannelmixer=rr=${left}:gg=${left}:bb=${left}`);

    return stages;
}

function toMatrixFilter(): string {
    const [r, g, b] = BT2020_TO_BT709;

    return `colorchannelmixer=rr=${r[0]}:rg=${r[1]}:rb=${r[2]}:gr=${g[0]}:gg=${g[1]}:gb=${g[2]}:br=${b[0]}:bg=${b[1]}:bb=${b[2]}`;
}

/**
 * Lookup that turns the signal into linear light, per channel, in the 16-bit range. HLG: the inverse OETF, which
 * gives scene light (gain 4 after it restores a 100 nit reference white). PQ: the ST 2084 EOTF, in units of 10000 nits
 * and multiplied by 16 so 100 nits lands at 0.16 of the range with room above it (anything over 625 nits clips).
 */
function toLinearLut(kind: HdrKind): { lut: string; gain: number } {
    if (kind === 'hlg') {
        const e = 'val/maxval';

        return {
            lut: `if(lte(${e}\\,0.5)\\,pow(${e}\\,2)/3\\,(exp((${e}-0.55991073)/0.17883277)+0.28466892)/12)*maxval`,
            gain: 4,
        };
    }

    const p = 'pow(val/maxval\\,1/78.84375)';

    return {
        lut: `min(16*pow(max(${p}-0.8359375\\,0)/(18.8515625-18.6875*${p})\\,1/0.1593017578125)\\,1)*maxval`,
        gain: 100 / 16,
    };
}

function toFallbackChain(kind: HdrKind): string {
    const { lut, gain } = toLinearLut(kind);
    const encode = 'pow(val/maxval\\,1/2.2)*maxval';

    return [
        'scale=in_color_matrix=bt2020:in_range=tv',
        'format=gbrp16le',
        `lutrgb=r=${lut}:g=${lut}:b=${lut}`,
        'format=gbrpf32le',
        toMatrixFilter(),
        ...toGainStages(gain),
        'tonemap=hable:desat=0',
        'format=gbrp16le',
        `lutrgb=r=${encode}:g=${encode}:b=${encode}`,
        'scale=out_color_matrix=bt709:out_range=tv',
        'format=yuv420p',
        BT709_TAGS,
    ].join(',');
}

function toZscaleChain(): string {
    return [
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
        BT709_TAGS,
    ].join(',');
}

export function toToneMap(kind: HdrKind, hasZscale: boolean): ToneMap {
    if (hasZscale) return { name: 'zscale-hable', chain: toZscaleChain() };

    return { name: kind === 'hlg' ? 'fallback-hlg' : 'fallback-pq', chain: toFallbackChain(kind) };
}
