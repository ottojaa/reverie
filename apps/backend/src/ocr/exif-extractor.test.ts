import { beforeEach, describe, expect, it, vi } from 'vitest';

const parse = vi.hoisted(() => vi.fn());

vi.mock('exifr', () => ({ default: { parse } }));
vi.mock('@webkitty/geo-rev', () => ({ createRevGeocoder: async () => ({ lookup: () => ({ record: { name: 'Helsinki', countryCode: 'FI' } }) }) }));

import { extractExifMetadata, toPhotoMetadataValues } from './exif-extractor';
import type { ExifMetadata } from './types';

const EMPTY: ExifMetadata = { latitude: null, longitude: null, city: null, country: null, takenAt: null, cameraMake: null, cameraModel: null, lensModel: null };

describe('extractExifMetadata: camera facts', () => {
    beforeEach(() => parse.mockReset());

    it('reads make, model and lens, trimmed', async () => {
        parse.mockResolvedValue({ Make: 'Apple ', Model: ' iPhone 15 Pro', LensModel: 'iPhone 15 Pro back camera 6.86mm f/1.78' });

        expect(await extractExifMetadata(Buffer.from('x'))).toMatchObject({
            cameraMake: 'Apple',
            cameraModel: 'iPhone 15 Pro',
            lensModel: 'iPhone 15 Pro back camera 6.86mm f/1.78',
        });
    });

    it('treats blank, padded and non-text values as absent, and strips control characters', async () => {
        parse.mockResolvedValue({ Make: '   ', Model: 'Cam\u0000\u0000', LensModel: 42 });

        expect(await extractExifMetadata(Buffer.from('x'))).toMatchObject({ cameraMake: null, cameraModel: 'Cam', lensModel: null });
    });

    it('caps a very long value', async () => {
        parse.mockResolvedValue({ Make: 'x'.repeat(500) });

        expect((await extractExifMetadata(Buffer.from('x'))).cameraMake).toHaveLength(200);
    });

    it('still returns the date and GPS facts', async () => {
        parse.mockResolvedValue({ latitude: 60.17, longitude: 24.94, DateTimeOriginal: new Date('2025-06-01T10:00:00Z') });

        expect(await extractExifMetadata(Buffer.from('x'))).toMatchObject({ latitude: 60.17, city: 'Helsinki', country: 'Finland', cameraMake: null });
    });

    it('returns no facts when the file has no EXIF or cannot be parsed', async () => {
        parse.mockResolvedValue(undefined);
        expect(await extractExifMetadata(Buffer.from('x'))).toEqual(EMPTY);

        // A file whose tags blow up while being read: the failure is swallowed, not thrown at the OCR worker.
        parse.mockResolvedValue({
            get Make(): string {
                throw new Error('bad tag');
            },
        });
        expect(await extractExifMetadata(Buffer.from('x'))).toEqual(EMPTY);
    });
});

describe('toPhotoMetadataValues', () => {
    it('writes a row for an image whose only EXIF is the camera make', () => {
        expect(toPhotoMetadataValues({ ...EMPTY, cameraMake: 'Canon' })).toEqual({ camera_make: 'Canon' });
    });

    it('maps every field, and only the fields present', () => {
        const takenAt = new Date('2025-06-01');

        expect(
            toPhotoMetadataValues({
                latitude: 1,
                longitude: 2,
                city: 'Oulu',
                country: 'Finland',
                takenAt,
                cameraMake: 'Apple',
                cameraModel: 'iPhone',
                lensModel: 'wide',
            }),
        ).toEqual({
            latitude: 1,
            longitude: 2,
            city: 'Oulu',
            country: 'Finland',
            taken_at: takenAt,
            camera_make: 'Apple',
            camera_model: 'iPhone',
            lens_model: 'wide',
        });
        expect(toPhotoMetadataValues({ ...EMPTY, lensModel: 'wide' })).toEqual({ lens_model: 'wide' });
    });

    it('keeps a latitude of zero', () => {
        expect(toPhotoMetadataValues({ ...EMPTY, latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0 });
    });

    it('returns null when there is nothing to store', () => {
        expect(toPhotoMetadataValues(EMPTY)).toBeNull();
        expect(toPhotoMetadataValues(null)).toBeNull();
        expect(toPhotoMetadataValues(undefined)).toBeNull();
    });
});
