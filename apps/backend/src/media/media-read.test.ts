import { readFileSync } from 'fs';
import type { Kysely } from 'kysely';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/schema';
import { buildExifJpeg, type ExifFixture } from '../testing/exif-fixture';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { findDocumentsMissingMediaRead, readDocumentMedia, type MediaReadDeps } from './media-read';
import { parseFfprobe, VideoUnreadableError, type VideoProbe } from './video-probe';

const TAKEN = new Date('2026-01-02T03:04:05Z');
const EXIF: ExifFixture = {
    make: 'Apple',
    model: 'iPhone 15',
    lensModel: 'back camera',
    dateTimeOriginal: '2024:05:01 14:03:22',
    offsetTimeOriginal: '+03:00',
    iso: 80,
    fNumber: [178, 100],
    exposureTime: [1, 120],
    focalLength: [686, 100],
    focalLength35mm: 24,
    flash: 0,
    orientation: 6,
    pixelWidth: 4032,
    pixelHeight: 3024,
    gps: { latitude: 60.1699, longitude: 24.9384 },
};

function loadProbe(name: string): VideoProbe {
    return parseFfprobe(JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.ffprobe.json`), 'utf8')));
}

describeDb('reading EXIF and video facts from the stored file', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    let probed: string[];
    const bytes = async () => buildExifJpeg(EXIF);
    const deps = (overrides: Partial<MediaReadDeps> = {}): MediaReadDeps => ({
        db,
        readFile: bytes,
        probeVideo: async (path) => {
            probed.push(path);

            return loadProbe('hevc-mov-rotated-gps');
        },
        ...overrides,
    });

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        userId = await seedUser(db, 'owner');
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });
    beforeEach(async () => {
        await db.deleteFrom('documents').execute();
        probed = [];
    });

    const image = (name: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) => seedDocument(db, { userId, name, mime: 'image/jpeg', ...extra });
    const video = (name: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) =>
        seedDocument(db, { userId, name, mime: 'video/quicktime', ...extra });
    const metadata = (id: string) => db.selectFrom('photo_metadata').selectAll().where('document_id', '=', id).executeTakeFirst();
    const videoRow = (id: string) => db.selectFrom('video_metadata').selectAll().where('document_id', '=', id).executeTakeFirst();
    const markers = (id: string) => db.selectFrom('documents').select(['camera_read_at', 'media_read_at']).where('id', '=', id).executeTakeFirstOrThrow();

    describe('an image', () => {
        it('stores the camera, the exposure, the time and the place for an image with no photo_metadata, and marks it read', async () => {
            const id = await image('phone.jpg');

            expect(await readDocumentMedia(deps(), id)).toBe('read');
            expect(await metadata(id)).toMatchObject({
                camera_make: 'Apple',
                camera_model: 'iPhone 15',
                lens_model: 'back camera',
                iso: 80,
                f_number: 1.78,
                focal_length: 6.86,
                focal_length_35mm: 24,
                flash_fired: false,
                orientation: 6,
                pixel_width: 4032,
                pixel_height: 3024,
                taken_at: new Date('2024-05-01T14:03:22Z'),
                taken_at_offset: '+03:00',
                city: 'Helsinki',
                country: 'Finland',
            });
            expect((await metadata(id))?.exposure_time).toBeCloseTo(1 / 120, 6);

            const { camera_read_at, media_read_at } = await markers(id);

            expect(camera_read_at).not.toBeNull();
            expect(media_read_at).not.toBeNull();
        });

        it('fills only what is missing: a stored value is never replaced', async () => {
            const id = await image('mixed.jpg', { photo: { takenAt: TAKEN, city: 'Stored city', iso: 1600 } });

            await readDocumentMedia(deps(), id);

            expect(await metadata(id)).toMatchObject({
                camera_make: 'Apple',
                taken_at: TAKEN,
                city: 'Stored city',
                iso: 1600,
                f_number: 1.78,
                latitude: expect.closeTo(60.1699, 3),
            });
        });

        it('is idempotent: a second read changes nothing', async () => {
            const id = await image('twice.jpg');

            await readDocumentMedia(deps(), id);

            const first = await metadata(id);
            const firstMarkers = await markers(id);

            await readDocumentMedia(deps({ readFile: () => buildExifJpeg({ make: 'Other', iso: 3200 }) }), id);

            expect(await metadata(id)).toEqual(first);
            expect((await markers(id)).camera_read_at).toEqual(firstMarkers.camera_read_at);
        });

        it('marks an image with no EXIF read and writes no row: a screenshot stays without camera evidence', async () => {
            const id = await image('screenshot.png');

            expect(await readDocumentMedia(deps({ readFile: () => buildExifJpeg() }), id)).toBe('read');
            expect(await metadata(id)).toBeUndefined();
            expect((await markers(id)).media_read_at).not.toBeNull();
        });

        it('keeps a lone capture date a lone date: it is stored, but is not camera evidence', async () => {
            const id = await image('Screenshot_2026.jpg');

            await readDocumentMedia(deps({ readFile: () => buildExifJpeg({ dateTimeOriginal: '2026:01:02 03:04:05' }) }), id);

            expect(await metadata(id)).toMatchObject({ taken_at: TAKEN, camera_make: null, camera_model: null, lens_model: null, latitude: null });
        });

        it('treats a missing file as final: marked read, nothing stored', async () => {
            const id = await image('gone.jpg');

            const missing = async (): Promise<Buffer> => {
                throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
            };

            expect(await readDocumentMedia(deps({ readFile: missing }), id)).toBe('no-file');
            expect(await metadata(id)).toBeUndefined();

            const { camera_read_at, media_read_at } = await markers(id);

            expect(camera_read_at).not.toBeNull();
            expect(media_read_at).not.toBeNull();
        });

        it('lets any other read failure through for the queue to retry, and marks nothing', async () => {
            const id = await image('flaky.jpg');

            const broken = async (): Promise<Buffer> => {
                throw new Error('disk on fire');
            };

            await expect(readDocumentMedia(deps({ readFile: broken }), id)).rejects.toThrow('disk on fire');
            expect(await markers(id)).toEqual({ camera_read_at: null, media_read_at: null });
        });

        it('keeps the camera marker of an image read before: only the newer columns are filled, and the caller is told not to classify again', async () => {
            const id = await image('old.jpg', { cameraReadAt: TAKEN, photo: { cameraMake: 'Canon', takenAt: TAKEN } });

            expect(await readDocumentMedia(deps(), id)).toBe('refreshed');
            expect(await metadata(id)).toMatchObject({ camera_make: 'Canon', taken_at: TAKEN, iso: 80, orientation: 6 });

            const { camera_read_at, media_read_at } = await markers(id);

            expect(camera_read_at).toEqual(TAKEN);
            expect(media_read_at).not.toBeNull();
        });

        it('does not touch the OCR marker', async () => {
            const id = await image('marker.jpg');
            const before = (await db.selectFrom('documents').select('ocr_facts_at').where('id', '=', id).executeTakeFirstOrThrow()).ocr_facts_at;

            await readDocumentMedia(deps(), id);

            expect((await db.selectFrom('documents').select('ocr_facts_at').where('id', '=', id).executeTakeFirstOrThrow()).ocr_facts_at).toEqual(before);
        });
    });

    describe('a video', () => {
        it('stores the ffprobe facts, puts the place and date where photos keep theirs, and leaves the camera marker alone', async () => {
            const id = await video('clip.mov');

            expect(await readDocumentMedia(deps(), id)).toBe('video');
            expect(probed).toEqual(['/files/clip.mov']);
            expect(await videoRow(id)).toMatchObject({
                container: 'mov',
                video_codec: 'hevc',
                video_profile: 'Main 10',
                audio_codec: 'aac',
                width: 640,
                height: 360,
                rotation: 270,
                color_transfer: 'arib-std-b67',
                is_hdr: true,
            });
            expect(await metadata(id)).toMatchObject({
                city: 'Helsinki',
                country: 'Finland',
                taken_at: new Date('2024-05-01T14:03:22Z'),
                taken_at_offset: '+03:00',
            });
            expect((await metadata(id))?.latitude).toBeCloseTo(60.1699, 4);
            expect(await markers(id)).toMatchObject({ camera_read_at: null });
            expect((await markers(id)).media_read_at).not.toBeNull();
        });

        it('writes no photo row for a video with no place and no date, but still stores its facts', async () => {
            const id = await video('plain.mp4');

            await readDocumentMedia(deps({ probeVideo: async () => loadProbe('h264-mp4-no-audio') }), id);

            expect(await metadata(id)).toBeUndefined();
            expect(await videoRow(id)).toMatchObject({ video_codec: 'h264', audio_codec: null });
        });

        it('is idempotent and keeps a place or date already stored', async () => {
            const id = await video('twice.mov', { photo: { city: 'Stored city' } });

            await readDocumentMedia(deps(), id);
            await readDocumentMedia(deps(), id);

            const { processed_at, ...facts } = (await videoRow(id))!;

            expect(processed_at).toBeInstanceOf(Date);
            expect(await db.selectFrom('video_metadata').selectAll().execute()).toHaveLength(1);
            expect(facts).toMatchObject({ video_codec: 'hevc' });
            expect(await metadata(id)).toMatchObject({ city: 'Stored city', country: 'Finland' });
        });

        it('treats a missing or unreadable file as final: marked read, nothing stored', async () => {
            const gone = await video('gone.mov');
            const broken = await video('broken.mov');

            await readDocumentMedia(
                deps({
                    probeVideo: async () => {
                        throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
                    },
                }),
                gone,
            );
            await readDocumentMedia(
                deps({
                    probeVideo: async () => {
                        throw new VideoUnreadableError('not a video');
                    },
                }),
                broken,
            );

            for (const id of [gone, broken]) {
                expect(await videoRow(id)).toBeUndefined();
                expect((await markers(id)).media_read_at).not.toBeNull();
            }
        });

        it('lets a failure to run ffprobe through for the queue to retry, and marks nothing', async () => {
            const id = await video('retry.mov');

            await expect(
                readDocumentMedia(
                    deps({
                        probeVideo: async () => {
                            throw new Error('ffprobe timed out');
                        },
                    }),
                    id,
                ),
            ).rejects.toThrow('ffprobe timed out');
            expect((await markers(id)).media_read_at).toBeNull();
        });
    });

    it('ignores other documents and unknown ids', async () => {
        const pdf = await seedDocument(db, { userId, name: 'a.pdf' });

        expect(await readDocumentMedia(deps(), pdf)).toBe('no-media');
        expect(await readDocumentMedia(deps(), crypto.randomUUID())).toBe('no-document');
    });

    describe('finding what is left to read', () => {
        it('lists live images and videos not read yet, in id order, from a cursor, and no longer lists one once read', async () => {
            const ids = [await image('a.jpg'), await video('b.mov'), await image('c.jpg', { cameraReadAt: TAKEN })].sort();

            await image('trashed.jpg', { deleted: true });
            await image('done.jpg', { cameraReadAt: TAKEN, mediaReadAt: TAKEN });
            await seedDocument(db, { userId, name: 'doc.pdf' });

            // An image read before this marker existed (c.jpg) is listed: its full EXIF has not been read.
            expect(await findDocumentsMissingMediaRead(db, null, 10)).toEqual(ids);
            expect(await findDocumentsMissingMediaRead(db, ids[0]!, 10)).toEqual(ids.slice(1));
            expect(await findDocumentsMissingMediaRead(db, null, 2)).toEqual(ids.slice(0, 2));

            await readDocumentMedia(deps(), ids[0]!);

            expect(await findDocumentsMissingMediaRead(db, null, 10)).toEqual(ids.slice(1));
        });
    });
});
