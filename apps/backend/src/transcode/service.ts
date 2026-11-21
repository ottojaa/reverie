import { mkdir, mkdtemp, rm } from 'fs/promises';
import type { Kysely } from 'kysely';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database, Document } from '../db/schema';
import { NonRetryableJobError } from '../jobs/job.types';
import { toVideoExtension, type VideoProbe } from '../media/video-probe';
import { createWorkerLogger } from '../workers/worker.utils';
import { deleteTranscodeSetIfUnused, type TranscodeFileRemover } from './cleanup';
import type { FfmpegCapabilities } from './capabilities';
import { buildFfmpegArgs, type EncoderKind } from './ffmpeg-command';
import type { FfmpegRunner } from './ffmpeg-run';
import { toHdrKind, toSdrScaleArgs, toToneMap, type ToneMap, type ToneMapName } from './hdr-filters';
import { decideLadder } from './ladder';
import { findTranscodeSet, insertTranscodeSet, setTranscodeStatus, toMasterPath } from './repository';
import { loadSourceFacts, UnusableSourceError } from './source-facts';
import { storeSet, type SetWriter } from './store-set';

const logger = createWorkerLogger('Transcode');

export interface TranscodeDeps {
    db: Kysely<Database>;
    storage: SetWriter &
        TranscodeFileRemover & {
            fileExists: (path: string) => Promise<boolean>;
            getLocalFilePath: (storagePath: string, extension?: string) => Promise<{ path: string; cleanup: () => Promise<void> }>;
        };
    capabilities: () => Promise<FfmpegCapabilities>;
    runFfmpeg: FfmpegRunner;
    probe: (path: string) => Promise<VideoProbe>;
}

export interface TranscodeResult {
    [key: string]: unknown;
    skipped?: boolean;
    reason?: string;
    /** An identical upload already had its renditions; nothing was encoded. */
    shared?: boolean;
    encoder?: EncoderKind;
    toneMap?: ToneMapName | null;
    wallMs?: number;
    rungs?: Array<{ height: number; bytes: number }>;
    totalBytes?: number;
}

type TranscodeSource = Pick<Document, 'id' | 'file_path' | 'file_hash' | 'mime_type' | 'duration_seconds' | 'deleted_at'>;

/** The HDR to SDR chain for this source, or null for an SDR one. */
function chooseToneMap(colorTransfer: string | null, zscale: boolean): ToneMap | null {
    const kind = toHdrKind(colorTransfer);

    return kind ? toToneMap(kind, zscale) : null;
}

export interface TranscodeOptions {
    /**
     * The last attempt: encode on the CPU and tone map with plain filters, whatever the machine reports. The GPU and zscale
     * paths depend on the ffmpeg build, and a video must still get its ladder if they error on it.
     */
    safeMode?: boolean;
}

/** The set is shared by hash, so a set that is stored and whole is reused without encoding. */
async function hasStoredSet(deps: TranscodeDeps, fileHash: string): Promise<boolean> {
    const set = await findTranscodeSet(deps.db, fileHash);

    return set !== null && (await deps.storage.fileExists(toMasterPath(fileHash)));
}

function toProgressReporter(durationSeconds: number | null, report: (percent: number) => Promise<void>): (encodedSeconds: number) => void {
    let lastReported = 0;

    return (encodedSeconds) => {
        if (!durationSeconds) return;

        const percent = Math.min(99, Math.floor((encodedSeconds / durationSeconds) * 100));

        // About every 5%: each report is a Redis publish.
        if (percent < lastReported + 5) return;

        lastReported = percent;
        void report(percent).catch(() => {});
    };
}

async function encodeAndStore(
    deps: TranscodeDeps,
    document: TranscodeSource,
    report: (percent: number) => Promise<void>,
    options: TranscodeOptions,
): Promise<TranscodeResult> {
    const startedAt = Date.now();

    if (!(await deps.storage.fileExists(document.file_path))) throw new NonRetryableJobError('Original file is missing: ' + document.file_path);

    const original = await deps.storage.getLocalFilePath(document.file_path, toVideoExtension(document.mime_type));
    const workDir = await mkdtemp(join(tmpdir(), 'reverie-transcode-'));

    try {
        const source = await loadSourceFacts(deps.db, document.id, () => deps.probe(original.path));
        const ladder = decideLadder(source);
        const capabilities = await deps.capabilities();
        const encoder: EncoderKind = capabilities.nvenc && !options.safeMode ? 'nvenc' : 'cpu';
        const toneMap = chooseToneMap(source.colorTransfer, capabilities.zscale && !options.safeMode);
        const sdrScaleArgs = toSdrScaleArgs(source.colorSpace, source.pixelFormat);

        await Promise.all(ladder.rungs.map((rung) => mkdir(join(workDir, `v${rung.name}`), { recursive: true })));
        await deps.runFfmpeg(
            buildFfmpegArgs({ inputPath: original.path, outDir: workDir, ladder, encoder, toneMap, sdrScaleArgs, hasAudio: source.hasAudio }),
            toProgressReporter(document.duration_seconds, report),
        );

        const stored = await storeSet(deps.storage, workDir, document.file_hash, ladder.rungs);

        await insertTranscodeSet(deps.db, document.file_hash, { ...stored, encoder, toneMap: toneMap?.name ?? null });

        // A purge that ran during the encode found no row to remove: if nothing uses this content any more, the set is an orphan.
        if (await deleteTranscodeSetIfUnused(deps.db, deps.storage, document.file_hash))
            return { skipped: true, reason: 'document was purged during the encode' };

        const wallMs = Date.now() - startedAt;

        logger.info('Transcoded', {
            documentId: document.id,
            encoder,
            toneMap: toneMap?.name ?? null,
            wallMs,
            rungs: stored.rungs,
            totalBytes: stored.totalBytes,
        });

        return {
            encoder,
            toneMap: toneMap?.name ?? null,
            wallMs,
            rungs: stored.rungs.map(({ height, bytes }) => ({ height, bytes })),
            totalBytes: stored.totalBytes,
            shared: false,
        };
    } finally {
        await original.cleanup().catch(() => {});
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Gives one video its HLS ladder. The original is only read. Status: processing while it encodes, complete at the end,
 * and left 'processing' on a throw (the worker marks it failed once the retries are used up, and the original stays playable).
 */
export async function transcodeDocument(
    deps: TranscodeDeps,
    documentId: string,
    report: (percent: number) => Promise<void>,
    options: TranscodeOptions = {},
): Promise<TranscodeResult> {
    const document = await deps.db
        .selectFrom('documents')
        .select(['id', 'file_path', 'file_hash', 'mime_type', 'duration_seconds', 'deleted_at'])
        .where('id', '=', documentId)
        .executeTakeFirst();

    if (!document) return { skipped: true, reason: 'document no longer exists' };

    // Left 'pending': a restored document is found by the backfill.
    if (document.deleted_at !== null) return { skipped: true, reason: 'document is in the trash' };

    if (await hasStoredSet(deps, document.file_hash)) {
        await setTranscodeStatus(deps.db, documentId, 'complete');

        return { shared: true };
    }

    await setTranscodeStatus(deps.db, documentId, 'processing');

    try {
        const result = await encodeAndStore(deps, document, report, options);

        if (result.skipped) return result;

        await setTranscodeStatus(deps.db, documentId, 'complete');

        return result;
    } catch (error) {
        // A video with no readable picture will never get one.
        if (error instanceof UnusableSourceError) throw new NonRetryableJobError(error.message);

        throw error;
    }
}
