import { createRevGeocoder } from '@webkitty/geo-rev';
import exifr from 'exifr';
import type { ExifMetadata } from './types';

export type { ExifMetadata };

let geocoderPromise: ReturnType<typeof createRevGeocoder> | null = null;

function getGeocoder() {
    if (!geocoderPromise) {
        geocoderPromise = createRevGeocoder();
    }

    return geocoderPromise;
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

function countryCodeToName(code: string): string {
    try {
        return displayNames.of(code.toUpperCase()) ?? code;
    } catch {
        return code;
    }
}

/** An EXIF string field, trimmed; null when absent or blank (some devices write padding or empty tags). */
function toExifText(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    // eslint-disable-next-line no-control-regex
    const text = value.replace(/[\u0000-\u001f]/g, '').trim();

    return text === '' ? null : text.slice(0, 200);
}

export async function extractExifMetadata(buffer: Buffer): Promise<ExifMetadata> {
    const result: ExifMetadata = {
        latitude: null,
        longitude: null,
        city: null,
        country: null,
        takenAt: null,
        cameraMake: null,
        cameraModel: null,
        lensModel: null,
    };

    try {
        const exif = await exifr.parse(buffer, {
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'LensModel'],
            translateValues: true,
        });

        if (!exif) return result;

        // Number.isFinite (not typeof): exifr yields NaN for malformed GPS rationals,
        // and typeof NaN === 'number' would let it into the database
        if (Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude)) {
            result.latitude = exif.latitude;
            result.longitude = exif.longitude;

            const geocoder = await getGeocoder();
            const geo = geocoder.lookup({ latitude: exif.latitude, longitude: exif.longitude });

            if (geo?.record) {
                result.city = geo.record.name;
                result.country = countryCodeToName(geo.record.countryCode);
            }
        }

        result.cameraMake = toExifText(exif.Make);
        result.cameraModel = toExifText(exif.Model);
        result.lensModel = toExifText(exif.LensModel);

        const dateValue = exif.DateTimeOriginal ?? exif.CreateDate;

        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            result.takenAt = dateValue;
        }
    } catch {
        // EXIF parsing failures are non-fatal
    }

    return result;
}

/** The `photo_metadata` columns to write for an image's EXIF: only the fields it has, or null when it has none at all. */
export function toPhotoMetadataValues(exif: ExifMetadata | null | undefined): Record<string, string | number | Date> | null {
    if (!exif) return null;

    const values = {
        ...(exif.latitude != null && { latitude: exif.latitude }),
        ...(exif.longitude != null && { longitude: exif.longitude }),
        ...(exif.city != null && { city: exif.city }),
        ...(exif.country != null && { country: exif.country }),
        ...(exif.takenAt != null && { taken_at: exif.takenAt }),
        ...(exif.cameraMake != null && { camera_make: exif.cameraMake }),
        ...(exif.cameraModel != null && { camera_model: exif.cameraModel }),
        ...(exif.lensModel != null && { lens_model: exif.lensModel }),
    };

    return Object.keys(values).length === 0 ? null : values;
}
