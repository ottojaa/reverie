import { describe, expect, it } from 'vitest';
import { buildExifJpeg } from '../testing/exif-fixture';
import { extractExifMetadata } from './exif-extractor';

/** The extractor on real JPEG bytes, with a real (offline) geocoder: no mocks between the file and the result. */

const FULL = {
    make: 'Apple',
    model: 'iPhone 15 Pro',
    lensModel: 'iPhone 15 Pro back camera 6.86mm f/1.78',
    orientation: 6,
    dateTimeOriginal: '2024:05:01 14:03:22',
    subSecTimeOriginal: '123',
    offsetTimeOriginal: '+03:00',
    exposureTime: [1, 120],
    fNumber: [178, 100],
    iso: 80,
    focalLength: [686, 100],
    focalLength35mm: 24,
    flash: 9,
    pixelWidth: 4032,
    pixelHeight: 3024,
    gps: { latitude: 60.1699, longitude: 24.9384 },
} as const;

describe('extractExifMetadata on fixture images', () => {
    it('reads every field of a fully tagged photo', async () => {
        const exif = await extractExifMetadata(await buildExifJpeg({ ...FULL, exposureTime: [1, 120], fNumber: [178, 100], focalLength: [686, 100] }));

        expect(exif).toMatchObject({
            cameraMake: 'Apple',
            cameraModel: 'iPhone 15 Pro',
            lensModel: 'iPhone 15 Pro back camera 6.86mm f/1.78',
            iso: 80,
            fNumber: 1.78,
            focalLength: 6.86,
            focalLength35mm: 24,
            flashFired: true,
            orientation: 6,
            pixelWidth: 4032,
            pixelHeight: 3024,
            takenAtOffset: '+03:00',
            city: 'Helsinki',
            country: 'Finland',
        });
        expect(exif.exposureTime).toBeCloseTo(1 / 120, 6);
        expect(exif.latitude).toBeCloseTo(60.1699, 3);
        expect(exif.longitude).toBeCloseTo(24.9384, 3);
        // The clock reading, kept as if UTC with its milliseconds: it must not move with the server's time zone.
        expect(exif.takenAt?.toISOString()).toBe('2024-05-01T14:03:22.123Z');
    });

    it('returns an empty result for a JPEG with no EXIF at all', async () => {
        const exif = await extractExifMetadata(await buildExifJpeg());

        expect(Object.values(exif).every((value) => value === null)).toBe(true);
    });

    it('leaves out whatever the camera did not write', async () => {
        const exif = await extractExifMetadata(await buildExifJpeg({ make: 'Canon', iso: 400 }));

        expect(exif).toMatchObject({
            cameraMake: 'Canon',
            iso: 400,
            fNumber: null,
            exposureTime: null,
            focalLength: null,
            flashFired: null,
            orientation: null,
            takenAt: null,
            takenAtOffset: null,
            latitude: null,
        });
    });

    it('decodes the flash bit field: fired, and not fired', async () => {
        expect((await extractExifMetadata(await buildExifJpeg({ flash: 0x19 }))).flashFired).toBe(true);
        expect((await extractExifMetadata(await buildExifJpeg({ flash: 0x10 }))).flashFired).toBe(false);
    });

    it('keeps every orientation as its EXIF number and drops an out-of-range one', async () => {
        for (const orientation of [1, 3, 6, 8]) expect((await extractExifMetadata(await buildExifJpeg({ orientation }))).orientation).toBe(orientation);

        expect((await extractExifMetadata(await buildExifJpeg({ orientation: 9 }))).orientation).toBeNull();
    });

    it('falls back to the digitised time and its own offset when there is no original time', async () => {
        const exif = await extractExifMetadata(
            await buildExifJpeg({ dateTimeDigitized: '2023:12:31 23:59:59', offsetTimeDigitized: '-05:00', offsetTimeOriginal: '+09:00' }),
        );

        expect(exif.takenAt?.toISOString()).toBe('2023-12-31T23:59:59.000Z');
        expect(exif.takenAtOffset).toBe('-05:00');
    });

    it('keeps the time but no offset when the offset tag is missing or malformed', async () => {
        const missing = await extractExifMetadata(await buildExifJpeg({ dateTimeOriginal: '2024:05:01 14:03:22' }));
        const malformed = await extractExifMetadata(await buildExifJpeg({ dateTimeOriginal: '2024:05:01 14:03:22', offsetTimeOriginal: 'CEST' }));

        expect(missing.takenAt?.toISOString()).toBe('2024-05-01T14:03:22.000Z');
        expect(missing.takenAtOffset).toBeNull();
        expect(malformed.takenAtOffset).toBeNull();
    });

    it('ignores a placeholder date such as the zero date some cameras write', async () => {
        const exif = await extractExifMetadata(await buildExifJpeg({ dateTimeOriginal: '0000:00:00 00:00:00' }));

        expect(exif.takenAt).toBeNull();
    });

    it('reads southern and western coordinates as negative', async () => {
        const exif = await extractExifMetadata(await buildExifJpeg({ gps: { latitude: -33.8688, longitude: -70.6693 } }));

        expect(exif.latitude).toBeCloseTo(-33.8688, 3);
        expect(exif.longitude).toBeCloseTo(-70.6693, 3);
    });
});
