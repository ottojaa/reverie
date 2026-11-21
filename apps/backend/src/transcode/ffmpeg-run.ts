import { spawn } from 'child_process';

/** An encode that prints no progress for this long is taken to be hung and killed, so it cannot hold the queue's one slot for ever. */
const STALL_MS = 15 * 60_000;

const STDERR_TAIL_BYTES = 2000;

/** Reads the position, in seconds, from one `-progress` line (`out_time_us=1234567`), or null for any other line. */
export function toProgressSeconds(line: string): number | null {
    const match = /^out_time_us=(-?\d+)$/.exec(line.trim());

    if (!match) return null;

    const seconds = Number(match[1]) / 1_000_000;

    return seconds > 0 ? seconds : 0;
}

export type FfmpegRunner = (args: string[], onSeconds: (seconds: number) => void) => Promise<void>;

/** Runs ffmpeg, reporting how far into the source it has got. Rejects with the end of ffmpeg's error output. */
export const runFfmpeg: FfmpegRunner = (args, onSeconds) =>
    new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let pending = '';
        let stalled = false;
        let timer = setTimeout(stop, STALL_MS);

        function stop(): void {
            stalled = true;
            child.kill('SIGKILL');
        }

        function touch(): void {
            clearTimeout(timer);
            timer = setTimeout(stop, STALL_MS);
        }

        child.stdout.on('data', (chunk: Buffer) => {
            touch();
            const lines = (pending + chunk.toString('utf8')).split('\n');

            pending = lines.pop() ?? '';

            for (const line of lines) {
                const seconds = toProgressSeconds(line);

                if (seconds !== null) onSeconds(seconds);
            }
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);

            if (code === 0) return resolve();

            reject(new Error((stalled ? 'ffmpeg stalled and was stopped: ' : 'ffmpeg failed: ') + stderr.trim()));
        });
    });
