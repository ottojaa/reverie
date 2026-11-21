import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const parse = vi.hoisted(() => vi.fn());

vi.mock('exifr', () => ({ default: { parse } }));
vi.mock('@webkitty/geo-rev', () => ({ createRevGeocoder: async () => ({ lookup: () => ({ record: { name: 'Helsinki', countryCode: 'FI' } }) }) }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { findDocumentsMissingCameraRead, readDocumentCamera } from './camera-read';

const TAKEN = new Date('2026-01-02T03:04:05Z');

describeDb('reading the camera columns from the stored file', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;
    let userId: string;
    const read = async () => Buffer.from('file bytes');

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
        parse.mockReset();
    });

    const image = (name: string, extra: Partial<Parameters<typeof seedDocument>[1]> = {}) => seedDocument(db, { userId, name, mime: 'image/jpeg', ...extra });
    const metadata = (id: string) => db.selectFrom('photo_metadata').selectAll().where('document_id', '=', id).executeTakeFirst();
    const readAt = async (id: string) =>
        (await db.selectFrom('documents').select('camera_read_at').where('id', '=', id).executeTakeFirstOrThrow()).camera_read_at;

    it('stores make, model, lens, GPS and place for an image with no photo_metadata, and marks it read', async () => {
        const id = await image('phone.jpg');

        parse.mockResolvedValue({ Make: 'Apple', Model: 'iPhone 15', LensModel: 'back camera', latitude: 60.17, longitude: 24.94, DateTimeOriginal: TAKEN });

        expect(await readDocumentCamera({ db, readFile: read }, id)).toBe('read');
        expect(await metadata(id)).toMatchObject({
            camera_make: 'Apple',
            camera_model: 'iPhone 15',
            lens_model: 'back camera',
            latitude: 60.17,
            city: 'Helsinki',
            taken_at: TAKEN,
        });
        expect(await readAt(id)).not.toBeNull();
    });

    it('fills only what is missing: a stored value is never replaced', async () => {
        const id = await image('mixed.jpg', { photo: { takenAt: TAKEN, city: 'Stored city' } });

        parse.mockResolvedValue({ Make: 'Apple', DateTimeOriginal: new Date('2020-01-01T00:00:00Z'), latitude: 60.17, longitude: 24.94 });
        await readDocumentCamera({ db, readFile: read }, id);

        expect(await metadata(id)).toMatchObject({ camera_make: 'Apple', taken_at: TAKEN, city: 'Stored city', latitude: 60.17 });
    });

    it('is idempotent: a second read changes nothing', async () => {
        const id = await image('twice.jpg');

        parse.mockResolvedValue({ Make: 'Apple', Model: 'iPhone 15' });
        await readDocumentCamera({ db, readFile: read }, id);

        const first = await metadata(id);

        parse.mockResolvedValue({ Make: 'Other', Model: 'Other' });
        await readDocumentCamera({ db, readFile: read }, id);

        expect(await metadata(id)).toEqual(first);
    });

    it('marks an image with no EXIF read and writes no row: a screenshot stays without camera evidence', async () => {
        const id = await image('screenshot.png');

        parse.mockResolvedValue(undefined);

        expect(await readDocumentCamera({ db, readFile: read }, id)).toBe('read');
        expect(await metadata(id)).toBeUndefined();
        expect(await readAt(id)).not.toBeNull();
    });

    it('keeps a lone capture date a lone date: it is stored, but is not camera evidence', async () => {
        const id = await image('Screenshot_2026.jpg');

        parse.mockResolvedValue({ DateTimeOriginal: TAKEN });
        await readDocumentCamera({ db, readFile: read }, id);

        expect(await metadata(id)).toMatchObject({ taken_at: TAKEN, camera_make: null, camera_model: null, lens_model: null, latitude: null });
    });

    it('treats a missing file as final: marked read, nothing stored', async () => {
        const id = await image('gone.jpg');

        const missing = async (): Promise<Buffer> => {
            throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
        };

        expect(await readDocumentCamera({ db, readFile: missing }, id)).toBe('no-file');
        expect(await metadata(id)).toBeUndefined();
        expect(await readAt(id)).not.toBeNull();
    });

    it('lets any other read failure through for the queue to retry, and does not mark the image', async () => {
        const id = await image('flaky.jpg');

        const broken = async (): Promise<Buffer> => {
            throw new Error('disk on fire');
        };

        await expect(readDocumentCamera({ db, readFile: broken }, id)).rejects.toThrow('disk on fire');
        expect(await readAt(id)).toBeNull();
    });

    it('does not touch the OCR marker, and ignores non-images and unknown documents', async () => {
        const id = await image('marker.jpg');
        const pdf = await seedDocument(db, { userId, name: 'a.pdf' });
        const before = (await db.selectFrom('documents').select('ocr_facts_at').where('id', '=', id).executeTakeFirstOrThrow()).ocr_facts_at;

        parse.mockResolvedValue({ Make: 'Apple' });
        await readDocumentCamera({ db, readFile: read }, id);

        expect((await db.selectFrom('documents').select('ocr_facts_at').where('id', '=', id).executeTakeFirstOrThrow()).ocr_facts_at).toEqual(before);
        expect(await readDocumentCamera({ db, readFile: read }, pdf)).toBe('no-image');
        expect(await readDocumentCamera({ db, readFile: read }, crypto.randomUUID())).toBe('no-document');
    });

    describe('finding what is left to read', () => {
        it('lists live images not read yet, in id order, from a cursor, and no longer lists one once read', async () => {
            const ids = [await image('a.jpg'), await image('b.jpg'), await image('c.jpg')].sort();

            await image('trashed.jpg', { deleted: true });
            await image('done.jpg', { cameraReadAt: TAKEN });
            await seedDocument(db, { userId, name: 'doc.pdf' });

            expect(await findDocumentsMissingCameraRead(db, null, 10)).toEqual(ids);
            expect(await findDocumentsMissingCameraRead(db, ids[0]!, 10)).toEqual(ids.slice(1));
            expect(await findDocumentsMissingCameraRead(db, null, 2)).toEqual(ids.slice(0, 2));

            parse.mockResolvedValue(undefined);
            await readDocumentCamera({ db, readFile: read }, ids[0]!);

            expect(await findDocumentsMissingCameraRead(db, null, 10)).toEqual(ids.slice(1));
        });
    });
});
