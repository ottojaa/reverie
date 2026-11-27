import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

const published = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../queues/redis', () => ({
    JOB_EVENTS_CHANNEL: 'job-events',
    getRedisPublisher: () => ({ publish: async (_channel: string, message: string) => void published.push(JSON.parse(message) as Record<string, unknown>) }),
    getRedisConnectionOptions: () => ({}),
}));

import { mkdir, writeFile } from 'fs/promises';
import type { Job } from 'bullmq';
import { JobEventSchema } from '@reverie/shared';
import { dirname, join } from 'path';
import { sql, type Kysely } from 'kysely';
import type { Database, VideoMetadata } from '../db/schema';
import { NonRetryableJobError } from '../jobs/job.types';
import { parseFfprobe } from '../media/video-probe';
import { dbProxy } from '../testing/db-proxy.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { processJobWithTracking, publishJobProgress } from '../workers/worker.utils';
import { findVideosToTranscode, runTranscodeBackfillPage, type TranscodeBackfillDeps } from './backfill';
import { deleteTranscodeSetIfUnused } from './cleanup';
import { queueTranscode } from './queue-transcode';
import { findTranscodeSet, insertTranscodeSet, toMasterPath } from './repository';
import { transcodeDocument, type TranscodeDeps } from './service';

/** An in-memory stand-in for the storage service, with every delete recorded. */
function createFakeStorage() {
    const files = new Map<string, Buffer>();
    const deleted: string[] = [];

    return {
        files,
        deleted,
        writeFile: async (path: string, buffer: Buffer) => void files.set(path, buffer),
        // Originals are always there; only the renditions are tracked.
        fileExists: async (path: string) => !path.startsWith('transcode/') || files.has(path),
        deleteFile: async (path: string) => {
            deleted.push(path);
            files.delete(path);
        },
        getLocalFilePath: async () => ({ path: '/original/video.mov', cleanup: async () => {} }),
    };
}

type FakeStorage = ReturnType<typeof createFakeStorage>;

/** An ffmpeg that writes what the real one would (a master, then a playlist, an init segment and two segments per rung), and records its arguments. */
function createFakeFfmpeg(durationSeconds = 10) {
    const runs: string[][] = [];

    const run: TranscodeDeps['runFfmpeg'] = async (args, onSeconds) => {
        runs.push(args);
        const outDir = dirname(dirname(args.at(-1)!));
        const dirs = args[args.indexOf('-var_stream_map') + 1]!.split(' ').map((entry) => entry.split('name:')[1]!);

        await writeFile(join(outDir, 'master.m3u8'), '#EXTM3U\n');

        for (const dir of dirs) {
            await mkdir(join(outDir, dir), { recursive: true });

            for (const name of ['index.m3u8', 'init.mp4', 'seg_00000.m4s', 'seg_00001.m4s']) await writeFile(join(outDir, dir, name), 'x'.repeat(100));
        }

        for (let seconds = 1; seconds <= durationSeconds; seconds++) onSeconds(seconds);
    };

    return { run, runs };
}

const NO_FACTS = parseFfprobe({});

/** The three-rung ladder of a 1080p video: a master plus four files per rung. */
const FILES_PER_SET = 13;

describeDb('video transcoding', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let storage: FakeStorage;
    let ffmpeg: ReturnType<typeof createFakeFfmpeg>;
    let capabilities: { nvenc: boolean; zscale: boolean };
    let deps: TranscodeDeps;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });
    beforeEach(async () => {
        await db.deleteFrom('transcode_sets').execute();
        await db.deleteFrom('processing_jobs').execute();
        await db.deleteFrom('documents').execute();
        published.length = 0;
        storage = createFakeStorage();
        ffmpeg = createFakeFfmpeg();
        capabilities = { nvenc: false, zscale: true };
        deps = { db, storage, capabilities: async () => capabilities, runFfmpeg: ffmpeg.run, probe: async () => NO_FACTS };
    });

    const statusOf = async (id: string) =>
        (await db.selectFrom('documents').select('transcode_status').where('id', '=', id).executeTakeFirstOrThrow()).transcode_status;
    const hashOf = async (id: string) => (await db.selectFrom('documents').select('file_hash').where('id', '=', id).executeTakeFirstOrThrow()).file_hash;
    const jobStatusOf = async (jobId: string) =>
        (await db.selectFrom('processing_jobs').select('status').where('id', '=', jobId).executeTakeFirstOrThrow()).status;

    async function seedVideo(options: { hash?: string; name?: string; deleted?: boolean; facts?: Partial<VideoMetadata> } = {}): Promise<string> {
        const id = await seedDocument(db, {
            userId,
            name: options.name ?? crypto.randomUUID() + '.mov',
            mime: 'video/quicktime',
            hash: options.hash ?? crypto.randomUUID(),
            deleted: options.deleted ?? false,
        });

        await db.updateTable('documents').set({ transcode_status: 'pending', duration_seconds: 10 }).where('id', '=', id).execute();
        await db
            .insertInto('video_metadata')
            .values({ document_id: id, width: 1920, height: 1080, rotation: 0, frame_rate: 30, audio_codec: 'aac', is_hdr: false, ...options.facts })
            .execute();

        return id;
    }

    async function insertJob(documentId: string, status: 'pending' | 'processing' | 'complete' | 'failed', priority = 0): Promise<string> {
        const row = await db
            .insertInto('processing_jobs')
            .values({ user_id: userId, job_type: 'transcode', target_type: 'document', target_id: documentId, status, priority })
            .returning('id')
            .executeTakeFirstOrThrow();

        return row.id;
    }

    describe('transcodeDocument', () => {
        it('encodes the ladder, stores it under the content hash with the master last, records the set and completes', async () => {
            const id = await seedVideo();
            const hash = await hashOf(id);
            const result = await transcodeDocument(deps, id, async () => {});
            const set = await findTranscodeSet(db, hash);

            expect(result).toMatchObject({ encoder: 'cpu', toneMap: null, shared: false, totalBytes: 1200 + 8 });
            expect(result.rungs?.map((rung) => rung.height)).toEqual([1080, 720, 480]);
            expect(await statusOf(id)).toBe('complete');
            expect(set?.files.at(-1)).toBe(toMasterPath(hash));
            expect(set?.files).toHaveLength(FILES_PER_SET);
            expect([...storage.files.keys()].every((path) => path.startsWith(`transcode/${hash}/`))).toBe(true);
            expect(set?.rungs.map((rung) => rung.height)).toEqual([1080, 720, 480]);
        });

        it('leaves the original alone: it only reads it', async () => {
            const id = await seedVideo();

            await transcodeDocument(deps, id, async () => {});

            expect(storage.deleted).toEqual([]);
            expect([...storage.files.keys()].some((path) => path.startsWith('/files/'))).toBe(false);
        });

        it('shares an identical upload: no second encode, and the same set serves both', async () => {
            const first = await seedVideo({ hash: 'same-content' });
            const second = await seedVideo({ hash: 'same-content', name: 'copy.mov' });

            await transcodeDocument(deps, first, async () => {});

            const result = await transcodeDocument(deps, second, async () => {});

            expect(result).toEqual({ shared: true });
            expect(ffmpeg.runs).toHaveLength(1);
            expect(await statusOf(second)).toBe('complete');
        });

        it('stores the set once when the same content encodes in both transcode lanes at the same time', async () => {
            const first = await seedVideo({ hash: 'both-lanes' });
            const second = await seedVideo({ hash: 'both-lanes', name: 'manual.mov' });
            const written: string[] = [];
            const { writeFile: write } = storage;
            let started = 0;

            let release = () => {};

            const bothStarted = new Promise<void>((resolve) => (release = resolve));

            // Neither encode finishes before the other has started, so neither finds a stored set at the start.
            const runFfmpeg: TranscodeDeps['runFfmpeg'] = async (args, onSeconds) => {
                if (++started === 2) release();

                await bothStarted;
                await ffmpeg.run(args, onSeconds);
            };

            storage.writeFile = async (path, buffer) => {
                written.push(path);
                await write(path, buffer);
            };

            const results = await Promise.all([first, second].map((id) => transcodeDocument({ ...deps, runFfmpeg }, id, async () => {})));

            expect(ffmpeg.runs).toHaveLength(2);
            expect(results.map((result) => result.shared).sort()).toEqual([false, true]);
            expect(written).toHaveLength(FILES_PER_SET);
            expect((await findTranscodeSet(db, 'both-lanes'))?.files).toHaveLength(FILES_PER_SET);
            expect([await statusOf(first), await statusOf(second)]).toEqual(['complete', 'complete']);
        });

        it('encodes again when the set row exists but its files are gone', async () => {
            const first = await seedVideo({ hash: 'lost-files' });
            const second = await seedVideo({ hash: 'lost-files', name: 'again.mov' });

            await transcodeDocument(deps, first, async () => {});
            storage.files.clear();
            await transcodeDocument(deps, second, async () => {});

            expect(ffmpeg.runs).toHaveLength(2);
            expect(storage.files.has(toMasterPath('lost-files'))).toBe(true);
        });

        it('lists the old and the new files when a broken set is encoded again, so a purge removes all of them', async () => {
            const hash = 'new-files';
            const master = 'transcode/new-files/master.m3u8';
            const record = { files: [master], rungs: [], encoder: 'cpu' as const, toneMap: null, totalBytes: 1 };

            await insertTranscodeSet(db, hash, { ...record, files: ['transcode/new-files/init.mp4', master] });
            await insertTranscodeSet(db, hash, { ...record, files: ['transcode/new-files/init_0.mp4', master] });

            expect((await findTranscodeSet(db, hash))?.files.sort()).toEqual([master, 'transcode/new-files/init.mp4', 'transcode/new-files/init_0.mp4'].sort());
        });

        it('uses NVENC when the card works, and tone maps HDR with the zscale chain when the build has it', async () => {
            const id = await seedVideo({ facts: { is_hdr: true, color_transfer: 'arib-std-b67', video_codec: 'hevc' } });

            capabilities = { nvenc: true, zscale: true };

            const result = await transcodeDocument(deps, id, async () => {});

            expect(result).toMatchObject({ encoder: 'nvenc', toneMap: 'zscale-hable' });
            expect(ffmpeg.runs[0]).toContain('h264_nvenc');
            expect(await findTranscodeSet(db, await hashOf(id))).toMatchObject({ encoder: 'nvenc', toneMap: 'zscale-hable' });
        });

        it('falls back to the filter chain for PQ when zscale is missing', async () => {
            const id = await seedVideo({ facts: { is_hdr: true, color_transfer: 'smpte2084' } });

            capabilities = { nvenc: false, zscale: false };

            expect(await transcodeDocument(deps, id, async () => {})).toMatchObject({ toneMap: 'fallback-pq' });
        });

        it('takes the plain CPU path in safe mode, whatever the machine reports', async () => {
            const id = await seedVideo({ facts: { is_hdr: true, color_transfer: 'arib-std-b67' } });

            capabilities = { nvenc: true, zscale: true };

            const result = await transcodeDocument(deps, id, async () => {}, { safeMode: true });

            expect(result).toMatchObject({ encoder: 'cpu', toneMap: 'fallback-hlg' });
            expect(ffmpeg.runs[0]).toContain('libx264');
        });

        it('converts an SDR source that is not BT.709 limited range, and leaves a BT.709 one alone', async () => {
            const ntsc = await seedVideo({ facts: { color_space: 'smpte170m' } });
            const plain = await seedVideo({ facts: { color_space: 'bt709' } });

            await transcodeDocument(deps, ntsc, async () => {});
            await transcodeDocument(deps, plain, async () => {});

            expect(ffmpeg.runs[0]!.join(' ')).toContain('in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv');
            expect(ffmpeg.runs[1]!.join(' ')).not.toContain('out_color_matrix');
        });

        it('leaves an SDR source untouched by any tone map', async () => {
            const id = await seedVideo();

            await transcodeDocument(deps, id, async () => {});

            expect(ffmpeg.runs[0]!.join(' ')).not.toContain('tonemap');
        });

        it('probes the file when the thumbnail step has stored no facts', async () => {
            const id = await seedVideo();

            await db.deleteFrom('video_metadata').where('document_id', '=', id).execute();

            const probed = parseFfprobe({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }], format: { duration: '10' } });

            await transcodeDocument({ ...deps, probe: async () => probed }, id, async () => {});

            expect((await findTranscodeSet(db, await hashOf(id)))?.rungs.map((rung) => rung.height)).toEqual([720, 480]);
        });

        it('skips a trashed video and leaves it pending for the backfill after a restore', async () => {
            const id = await seedVideo({ deleted: true });

            expect(await transcodeDocument(deps, id, async () => {})).toMatchObject({ skipped: true });
            expect(await statusOf(id)).toBe('pending');
            expect(ffmpeg.runs).toHaveLength(0);
        });

        it('skips a video that no longer exists', async () => {
            expect(await transcodeDocument(deps, crypto.randomUUID(), async () => {})).toMatchObject({ skipped: true });
        });

        it('removes the set it just stored when the last document was purged during the encode', async () => {
            const id = await seedVideo();
            const hash = await hashOf(id);
            const purging: TranscodeDeps = {
                ...deps,
                runFfmpeg: async (args, onSeconds) => {
                    await ffmpeg.run(args, onSeconds);
                    await db.deleteFrom('documents').where('id', '=', id).execute();
                },
            };

            expect(await transcodeDocument(purging, id, async () => {})).toMatchObject({ skipped: true });
            expect(await findTranscodeSet(db, hash)).toBeNull();
            expect(storage.files.size).toBe(0);
        });

        it('keeps the set when the document went to the trash during the encode: it keeps its renditions until purged', async () => {
            const id = await seedVideo();
            const trashing: TranscodeDeps = {
                ...deps,
                runFfmpeg: async (args, onSeconds) => {
                    await ffmpeg.run(args, onSeconds);
                    await db.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', id).execute();
                },
            };

            await transcodeDocument(trashing, id, async () => {});

            expect(await findTranscodeSet(db, await hashOf(id))).not.toBeNull();
        });

        it('leaves the status at processing when the encode throws, so a retry can run', async () => {
            const id = await seedVideo();
            const failing: TranscodeDeps = { ...deps, runFfmpeg: async () => Promise.reject(new Error('ffmpeg failed: out of disk')) };

            await expect(transcodeDocument(failing, id, async () => {})).rejects.toThrow('ffmpeg failed: out of disk');
            expect(await statusOf(id)).toBe('processing');
            expect(await findTranscodeSet(db, await hashOf(id))).toBeNull();
        });

        it('fails for good, without retries, for a video with no picture size', async () => {
            const id = await seedVideo({ facts: { width: null, height: null } });

            await expect(transcodeDocument(deps, id, async () => {})).rejects.toBeInstanceOf(NonRetryableJobError);
        });

        it('fails for good when the original file is missing', async () => {
            const id = await seedVideo();
            const missing: TranscodeDeps = { ...deps, storage: { ...storage, fileExists: async () => false } };

            await expect(transcodeDocument(missing, id, async () => {})).rejects.toBeInstanceOf(NonRetryableJobError);
        });

        it('reports progress about every 5 percent, and never reaches 100 before the upload is done', async () => {
            const id = await seedVideo();
            const percents: number[] = [];

            await transcodeDocument(deps, id, async (percent) => void percents.push(percent));

            expect(percents).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 99]);
        });
    });

    describe('status and job events', () => {
        /** A job as the worker runs it: the queue job id is the processing_jobs row's id. */
        async function runTracked(id: string, runner: TranscodeDeps, attemptsAllowed = 3): Promise<{ jobId: string; outcome: 'ok' | Error }> {
            const jobId = await insertJob(id, 'pending');
            const job = { id: jobId, data: { documentId: id, userId }, opts: { attempts: attemptsAllowed } } as unknown as Job<{
                documentId: string;
                userId: string;
            }>;
            const process = () => transcodeDocument(runner, id, (percent) => publishJobProgress(jobId, percent, id, undefined, userId, 'transcode'));

            try {
                await processJobWithTracking(job, process, { jobType: 'transcode' });

                return { jobId, outcome: 'ok' };
            } catch (error) {
                return { jobId, outcome: error as Error };
            }
        }

        it('publishes started, progress and complete, each tagged as a transcode and valid against the shared event schema', async () => {
            const id = await seedVideo();
            const { jobId } = await runTracked(id, deps);

            expect(published[0]).toMatchObject({ type: 'job:started' });
            expect(published.at(-1)).toMatchObject({ type: 'job:complete', status: 'complete', result: { encoder: 'cpu', shared: false } });
            expect(published.filter((event) => event['type'] === 'job:progress').length).toBeGreaterThan(1);

            for (const event of published) {
                expect(JobEventSchema.parse(event)).toMatchObject({ job_id: jobId, job_type: 'transcode', document_id: id, user_id: userId });
            }

            const row = await db.selectFrom('processing_jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow();

            expect(row.status).toBe('complete');
            expect(row.duration_ms).not.toBeNull();
        });

        it('ends a job whose document was purged as skipped, not complete', async () => {
            const id = await seedVideo();
            const purged: TranscodeDeps = {
                ...deps,
                runFfmpeg: async (args, onSeconds) => (
                    await ffmpeg.run(args, onSeconds),
                    void (await db.deleteFrom('documents').where('id', '=', id).execute())
                ),
            };
            const { jobId } = await runTracked(id, purged);

            expect(await jobStatusOf(jobId)).toBe('skipped');
            expect(published.at(-1)).toMatchObject({ type: 'job:complete', status: 'skipped' });
        });

        it('publishes failed only when the retries are used up', async () => {
            const id = await seedVideo();
            const failing: TranscodeDeps = { ...deps, runFfmpeg: async () => Promise.reject(new Error('ffmpeg failed: boom')) };
            const retried = await runTracked(id, failing, 2);

            expect(retried.outcome).toBeInstanceOf(Error);
            expect(published.map((event) => event['type'])).not.toContain('job:failed');
            expect(await jobStatusOf(retried.jobId)).not.toBe('failed');

            published.length = 0;

            const last = await runTracked(id, failing, 1);

            expect(published.at(-1)).toMatchObject({ type: 'job:failed', job_type: 'transcode', error_message: 'ffmpeg failed: boom' });
            expect(JobEventSchema.parse(published.at(-1))).toMatchObject({ status: 'failed' });
            expect(await jobStatusOf(last.jobId)).toBe('failed');
        });

        it('fails at once, without retries, for a source that can never be encoded', async () => {
            const id = await seedVideo({ facts: { width: null, height: null } });
            const { jobId } = await runTracked(id, deps, 3);

            expect(published.at(-1)).toMatchObject({ type: 'job:failed' });
            expect(await jobStatusOf(jobId)).toBe('failed');
        });
    });

    describe('refcounted cleanup', () => {
        it('removes the files and the row when the last document using the set is purged', async () => {
            const only = await seedVideo({ hash: 'a' });

            await transcodeDocument(deps, only, async () => {});

            expect(await deleteTranscodeSetIfUnused(db, storage, 'a', only)).toBe(true);
            expect(await findTranscodeSet(db, 'a')).toBeNull();
            expect(storage.files.size).toBe(0);
            // The master goes first: nothing can start playing a set that is half deleted.
            expect(storage.deleted[0]).toBe(toMasterPath('a'));
            expect(storage.deleted).toHaveLength(FILES_PER_SET);
        });

        it('keeps the set while another document has the same content', async () => {
            const first = await seedVideo({ hash: 'shared' });

            await seedVideo({ hash: 'shared', name: 'other.mov' });
            await transcodeDocument(deps, first, async () => {});

            expect(await deleteTranscodeSetIfUnused(db, storage, 'shared', first)).toBe(false);
            expect(await findTranscodeSet(db, 'shared')).not.toBeNull();
            expect(storage.files.has(toMasterPath('shared'))).toBe(true);
        });

        it('keeps the set for a trashed document: the trash keeps renditions until it purges', async () => {
            const trashed = await seedVideo({ hash: 'trashed' });

            await transcodeDocument(deps, trashed, async () => {});
            await db.updateTable('documents').set({ deleted_at: new Date() }).where('id', '=', trashed).execute();

            expect(await deleteTranscodeSetIfUnused(db, storage, 'trashed', crypto.randomUUID())).toBe(false);
            expect(storage.files.has(toMasterPath('trashed'))).toBe(true);
        });

        it('removes the set once the trashed document is purged', async () => {
            const doc = await seedVideo({ hash: 'purged' });

            await transcodeDocument(deps, doc, async () => {});
            await db.deleteFrom('documents').where('id', '=', doc).execute();

            expect(await deleteTranscodeSetIfUnused(db, storage, 'purged')).toBe(true);
            expect(storage.files.size).toBe(0);
        });

        it('is safe to run twice, and when there never was a set', async () => {
            const doc = await seedVideo({ hash: 'twice' });

            await transcodeDocument(deps, doc, async () => {});
            await db.deleteFrom('documents').where('id', '=', doc).execute();

            expect(await deleteTranscodeSetIfUnused(db, storage, 'twice')).toBe(true);
            expect(await deleteTranscodeSetIfUnused(db, storage, 'twice')).toBe(false);
            expect(await deleteTranscodeSetIfUnused(db, storage, 'never-encoded')).toBe(false);
        });

        it('carries on past a file that cannot be deleted', async () => {
            const doc = await seedVideo({ hash: 'stuck' });

            await transcodeDocument(deps, doc, async () => {});
            await db.deleteFrom('documents').where('id', '=', doc).execute();

            const flaky = { deleteFile: async (path: string) => (path.includes('init.mp4') ? Promise.reject(new Error('ENOENT')) : storage.deleteFile(path)) };

            expect(await deleteTranscodeSetIfUnused(db, flaky, 'stuck')).toBe(true);
            expect(await findTranscodeSet(db, 'stuck')).toBeNull();
            expect(storage.deleted).toHaveLength(FILES_PER_SET - 3);
        });
    });

    describe('queueTranscode', () => {
        it('inserts the job row, marks the video pending and queues the job under the row id', async () => {
            const id = await seedVideo();
            const added: Array<{ data: unknown; jobId: string }> = [];

            await db.updateTable('documents').set({ transcode_status: 'skipped' }).where('id', '=', id).execute();

            const queued = await queueTranscode(db, id, userId, undefined, async (data, jobId) => void added.push({ data, jobId }));
            const row = await db.selectFrom('processing_jobs').selectAll().where('target_id', '=', id).executeTakeFirstOrThrow();

            expect(queued).toBe(true);
            expect(row).toMatchObject({ job_type: 'transcode', status: 'pending', user_id: userId });
            expect(added).toEqual([{ data: { documentId: id, userId }, jobId: row.id }]);
            expect(await statusOf(id)).toBe('pending');
        });

        it('leaves a video that already has a job in line alone', async () => {
            const id = await seedVideo();
            const add = vi.fn(async () => {});

            await queueTranscode(db, id, userId, undefined, add);

            expect(await queueTranscode(db, id, userId, undefined, add)).toBe(false);
            expect(add).toHaveBeenCalledTimes(1);
        });

        it('queues again once the earlier job has finished', async () => {
            const id = await seedVideo();
            const add = vi.fn(async () => {});

            await queueTranscode(db, id, userId, undefined, add);
            await db.updateTable('processing_jobs').set({ status: 'failed' }).where('target_id', '=', id).execute();

            expect(await queueTranscode(db, id, userId, undefined, add)).toBe(true);
        });

        it('never throws: a queue that is down leaves the video pending, with no job row, for the backfill', async () => {
            const id = await seedVideo();
            const down = async () => Promise.reject(new Error('Redis is down'));

            expect(await queueTranscode(db, id, userId, undefined, down)).toBe(false);
            expect(await statusOf(id)).toBe('pending');
            expect(await db.selectFrom('processing_jobs').select('id').where('target_id', '=', id).execute()).toEqual([]);
            expect((await findVideosToTranscode(db, null, 10)).map((row) => row.id)).toEqual([id]);
        });
    });

    describe('backfill', () => {
        let busy: boolean;
        let queued: string[];
        let backfill: TranscodeBackfillDeps;

        beforeEach(() => {
            busy = false;
            queued = [];
            backfill = {
                db,
                isBusy: async () => busy,
                enqueue: async (id) => {
                    queued.push(id);
                    // As the real enqueue does: a job row, so the video has a job in line.
                    await insertJob(id, 'pending', 10);

                    return true;
                },
                batchSize: 2,
            };
        });

        it('finds only live, pending videos with no job in line', async () => {
            const pending = await seedVideo();
            const complete = await seedVideo();
            const trashed = await seedVideo({ deleted: true });
            const withJob = await seedVideo();
            const photo = await seedDocument(db, { userId, name: 'a.jpg', mime: 'image/jpeg' });

            await db.updateTable('documents').set({ transcode_status: 'complete' }).where('id', '=', complete).execute();
            await insertJob(withJob, 'processing');

            const found = (await findVideosToTranscode(db, null, 10)).map((row) => row.id);

            expect(found).toEqual([pending]);
            expect(found).not.toContain(photo);
            expect(found).not.toContain(trashed);
        });

        it('ignores a job row older than a week: a Redis that lost its queue does not hide the video for ever', async () => {
            const id = await seedVideo();
            const jobId = await insertJob(id, 'pending');

            await sql`UPDATE processing_jobs SET created_at = now() - interval '8 days' WHERE id = ${jobId}`.execute(db);

            expect((await findVideosToTranscode(db, null, 10)).map((row) => row.id)).toEqual([id]);
        });

        it('queues a batch per page, in id order, and says where to resume', async () => {
            const ids = [await seedVideo(), await seedVideo(), await seedVideo()].sort();
            const first = await runTranscodeBackfillPage(backfill, null);

            expect(queued).toEqual(ids.slice(0, 2));
            expect(first).toEqual({ kind: 'next', after: ids[1] });

            const second = await runTranscodeBackfillPage(backfill, ids[1]!);

            expect(queued).toEqual(ids);
            expect(second).toEqual({ kind: 'next', after: ids[2] });
            expect(await runTranscodeBackfillPage(backfill, ids[2]!)).toEqual({ kind: 'done' });
        });

        it('waits, and queues nothing, while thumbnails, OCR or other transcodes have work', async () => {
            await seedVideo();
            busy = true;

            expect(await runTranscodeBackfillPage(backfill, null)).toEqual({ kind: 'wait' });
            expect(queued).toEqual([]);

            busy = false;

            expect((await runTranscodeBackfillPage(backfill, null)).kind).toBe('next');
        });

        it('resumes after a restart: with no cursor it asks the database again and skips what is already queued or done', async () => {
            const ids = [await seedVideo(), await seedVideo(), await seedVideo()].sort();

            await runTranscodeBackfillPage(backfill, null);

            // The first two have jobs in line now; a restarted backfill (cursor lost) picks up only the third.
            expect(await runTranscodeBackfillPage(backfill, null)).toEqual({ kind: 'next', after: ids[2] });
            expect(queued).toEqual(ids);

            await db.updateTable('processing_jobs').set({ status: 'complete' }).execute();
            await db.updateTable('documents').set({ transcode_status: 'complete' }).execute();

            expect(await runTranscodeBackfillPage(backfill, null)).toEqual({ kind: 'done' });
        });

        it('does not retry a video whose job ran out of retries: it is failed, not pending', async () => {
            const id = await seedVideo();

            await db.updateTable('documents').set({ transcode_status: 'failed' }).where('id', '=', id).execute();

            expect(await runTranscodeBackfillPage(backfill, null)).toEqual({ kind: 'done' });
        });
    });
});
