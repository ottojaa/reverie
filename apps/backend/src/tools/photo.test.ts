import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { sql } from 'kysely';
import { toDisplayDate } from './document-output';
import { isPhoto, isPhotoSql, shownDateSql, withholdsImageContent, withholdsImageContentSql } from './photo';
import { seedDocument } from '../testing/seed';
import { describeDb, useWorld, type World } from '../testing/tool-world';

const taken = new Date('2022-07-15T10:00:00Z');
const base = {
    mime_type: 'image/jpeg',
    taken_at: null,
    latitude: null,
    longitude: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    camera_read_at: null,
};
const read = new Date('2026-01-01T00:00:00Z');

describe('isPhoto', () => {
    it('is true for an image with a camera make, model or lens, with no date at all', () => {
        expect(isPhoto({ ...base, camera_read_at: read, camera_make: 'Apple' })).toBe(true);
        expect(isPhoto({ ...base, camera_read_at: read, camera_model: 'Pixel 8' })).toBe(true);
        expect(isPhoto({ ...base, camera_read_at: read, lens_model: 'back camera' })).toBe(true);
        expect(isPhoto({ ...base, camera_read_at: read, camera_make: '' })).toBe(false);
    });

    it('ignores a lone capture date once the camera columns have been read: Android screenshots carry one', () => {
        expect(isPhoto({ ...base, camera_read_at: read, taken_at: taken })).toBe(false);
    });

    it('fails closed: a capture date holds an image back until its camera columns have been read', () => {
        expect(isPhoto({ ...base, taken_at: taken })).toBe(true);
    });

    it('is true for an image with both coordinates, and false with only one', () => {
        expect(isPhoto({ ...base, latitude: 60.1, longitude: 24.9 })).toBe(true);
        expect(isPhoto({ ...base, latitude: 60.1 })).toBe(false);
        expect(isPhoto({ ...base, longitude: 24.9 })).toBe(false);
    });

    it('is false for a screenshot or scan with no EXIF', () => {
        expect(isPhoto(base)).toBe(false);
    });

    it('is false for a non-image, whatever its metadata says', () => {
        expect(isPhoto({ ...base, mime_type: 'application/pdf', taken_at: taken, camera_make: 'Apple' })).toBe(false);
    });

    it('treats a coordinate that arrives as a numeric string from Postgres as a coordinate', () => {
        expect(isPhoto({ ...base, latitude: '60.1' as unknown as number, longitude: '24.9' as unknown as number })).toBe(true);
    });
});

describe('withholdsImageContent', () => {
    it('hides an EXIF photo and an image labelled photo, but not a screenshot or scan', () => {
        expect(withholdsImageContent({ ...base, camera_make: 'Apple', document_category: 'receipt' })).toBe(true);
        expect(withholdsImageContent({ ...base, document_category: 'photo' })).toBe(true);
        expect(withholdsImageContent({ ...base, document_category: 'screenshot' })).toBe(false);
        expect(withholdsImageContent({ ...base, document_category: 'document' })).toBe(false);
        expect(withholdsImageContent({ ...base, camera_read_at: read, taken_at: taken, document_category: 'screenshot' })).toBe(false);
    });

    it('does not hide a PDF labelled photo', () => {
        expect(withholdsImageContent({ ...base, mime_type: 'application/pdf', document_category: 'photo' })).toBe(false);
    });
});

describeDb('the SQL forms of the photo rule', () => {
    const ctx = useWorld();
    const w = new Proxy({} as World, { get: (_t, key) => ctx.world()[key as keyof World] });

    it('agree with the functions on every document in the test library', async () => {
        const rows = await w.db
            .selectFrom('documents as d')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select([
                'd.id',
                'd.mime_type',
                'd.document_category',
                'd.extracted_date',
                'd.camera_read_at',
                'pm.taken_at',
                'pm.latitude',
                'pm.longitude',
                'pm.camera_make',
                'pm.camera_model',
                'pm.lens_model',
                isPhotoSql().as('sql_photo'),
                withholdsImageContentSql().as('sql_withholds'),
                sql<string | null>`${shownDateSql()}::text`.as('sql_date'),
            ])
            .execute();

        expect(rows.length).toBeGreaterThan(10);

        for (const row of rows) {
            const facts = {
                ...row,
                latitude: row.latitude === null ? null : Number(row.latitude),
                longitude: row.longitude === null ? null : Number(row.longitude),
            };

            expect(row.sql_photo, row.id).toBe(isPhoto(facts));
            expect(row.sql_withholds, row.id).toBe(withholdsImageContent(facts));
            expect(row.sql_date, row.id).toBe(
                toDisplayDate({ ...facts, extracted_date: row.extracted_date, original_filename: '', folder_path: null, city: null, country: null }),
            );
        }
    });

    it('cover both kinds of withheld image and both kinds of non-photo image', async () => {
        const { docs } = w;
        const rows = await w.db
            .selectFrom('documents as d')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select(['d.id', isPhotoSql().as('photo'), withholdsImageContentSql().as('withholds')])
            .where('d.id', 'in', [docs.photo, docs.gpsOnly, docs.captioned, docs.screenshot, docs.emptyExif])
            .execute();
        const byId = new Map(rows.map((row) => [row.id, row]));

        expect(byId.get(docs.photo)).toMatchObject({ photo: true, withholds: true });
        expect(byId.get(docs.gpsOnly)).toMatchObject({ photo: true, withholds: true });
        expect(byId.get(docs.captioned)).toMatchObject({ photo: false, withholds: true });
        expect(byId.get(docs.screenshot)).toMatchObject({ photo: false, withholds: false });
        expect(byId.get(docs.emptyExif)).toMatchObject({ photo: false, withholds: false });
    });

    it('agree with the functions on camera evidence, a lone date before the camera read, and a lone date after it', async () => {
        const userId = w.alice;
        const date = new Date('2026-01-02T00:00:00Z');
        const makeOnly = await seedDocument(w.db, {
            userId,
            name: 'make.jpg',
            mime: 'image/jpeg',
            category: 'other',
            photo: { cameraMake: 'Apple' },
            cameraReadAt: date,
        });
        const dateUnread = await seedDocument(w.db, { userId, name: 'date-unread.jpg', mime: 'image/jpeg', category: 'other', photo: { takenAt: date } });
        const dateRead = await seedDocument(w.db, {
            userId,
            name: 'date-read.jpg',
            mime: 'image/jpeg',
            category: 'other',
            photo: { takenAt: date },
            cameraReadAt: date,
        });
        const rows = await w.db
            .selectFrom('documents as d')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select(['d.id', isPhotoSql().as('photo'), withholdsImageContentSql().as('withholds')])
            .where('d.id', 'in', [makeOnly, dateUnread, dateRead])
            .execute();
        const byId = new Map(rows.map((row) => [row.id, row]));

        expect(byId.get(makeOnly)).toMatchObject({ photo: true, withholds: true });
        expect(byId.get(dateUnread)).toMatchObject({ photo: true, withholds: true });
        expect(byId.get(dateRead)).toMatchObject({ photo: false, withholds: false });
    });
});
