import { execFile } from 'child_process';
import { env } from '../config/env';
import { createWorkerLogger } from '../workers/worker.utils';

const logger = createWorkerLogger('Transcode');

export interface FfmpegCapabilities {
    /** An NVENC encode actually worked: listing the encoder is not enough, a build can list it with no GPU in the box. */
    nvenc: boolean;
    /** This ffmpeg has the zscale filter (libzimg), which a proper HDR to SDR tone map needs. */
    zscale: boolean;
}

function run(args: string[]): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((resolve) => {
        execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            resolve({ ok: !error, stdout });
        });
    });
}

function listText(args: string[]): Promise<string> {
    return new Promise((resolve) => {
        execFile('ffmpeg', ['-hide_banner', ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => resolve(stdout));
    });
}

export async function detectCapabilities(): Promise<FfmpegCapabilities> {
    const [filters, encoders] = await Promise.all([listText(['-filters']), listText(['-encoders'])]);
    const zscale = /\bzscale\b/.test(filters);
    const hasNvencEncoder = /\bh264_nvenc\b/.test(encoders);
    const wanted = env.TRANSCODE_ENCODER;
    const nvenc =
        wanted !== 'cpu' &&
        hasNvencEncoder &&
        (await run(['-f', 'lavfi', '-i', 'color=size=256x256:duration=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'])).ok;

    logger.info('ffmpeg capabilities', { nvenc, zscale, hasNvencEncoder, requested: wanted });

    return { nvenc, zscale };
}

let detected: Promise<FfmpegCapabilities> | null = null;

/** Detected once per process and logged. */
export function getCapabilities(): Promise<FfmpegCapabilities> {
    detected ??= detectCapabilities();

    return detected;
}
