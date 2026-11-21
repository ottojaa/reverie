import { createRevGeocoder } from '@webkitty/geo-rev';
import exifr from 'exifr';
import { EXPOSURE_AND_TIME_TAGS, readCaptureTime, readExposureFacts } from './exif-tags';
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

/** The city and country nearest a coordinate, from the bundled offline geocoder; nulls when none is close. */
export async function lookupPlace(latitude: number, longitude: number): Promise<{ city: string | null; country: string | null }> {
    const geocoder = await getGeocoder();
    const geo = geocoder.lookup({ latitude, longitude });

    if (!geo?.record) return { city: null, country: null };

    return { city: geo.record.name, country: countryCodeToName(geo.record.countryCode) };
}

function emptyExifMetadata(): ExifMetadata {
    return {
        latitude: null,
        longitude: null,
        city: null,
        country: null,
        takenAt: null,
        takenAtOffset: null,
        cameraMake: null,
        cameraModel: null,
        lensModel: null,
        iso: null,
        fNumber: null,
        exposureTime: null,
        focalLength: null,
        focalLength35mm: null,
        flashFired: null,
        orientation: null,
        pixelWidth: null,
        pixelHeight: null,
    };
}

export async function extractExifMetadata(buffer: Buffer): Promise<ExifMetadata> {
    const result = emptyExifMetadata();

    try {
        // Nothing is translated or revived: orientation, flash and the sizes stay numbers, and the date stays the
        // string the camera wrote, so its clock reading does not pass through the server's time zone.
        const exif = await exifr.parse(buffer, {
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'Make', 'Model', 'LensModel', ...EXPOSURE_AND_TIME_TAGS],
            translateValues: false,
            reviveValues: false,
        });

        if (!exif) return result;

        // Number.isFinite (not typeof): exifr yields NaN for malformed GPS rationals,
        // and typeof NaN === 'number' would let it into the database
        if (Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude)) {
            result.latitude = exif.latitude;
            result.longitude = exif.longitude;
            Object.assign(result, await lookupPlace(exif.latitude, exif.longitude));
        }

        result.cameraMake = toExifText(exif.Make);
        result.cameraModel = toExifText(exif.Model);
        result.lensModel = toExifText(exif.LensModel);

        const time = readCaptureTime(exif);

        result.takenAt = time.takenAt;
        result.takenAtOffset = time.takenAtOffset;
        Object.assign(result, readExposureFacts(exif));
    } catch {
        // EXIF parsing failures are non-fatal
    }

    return result;
}

/** The `photo_metadata` columns to write for an image's EXIF: only the fields it has, or null when it has none at all. */
export function toPhotoMetadataValues(exif: ExifMetadata | null | undefined): Record<string, string | number | boolean | Date> | null {
    if (!exif) return null;

    const values = {
        ...(exif.latitude != null && { latitude: exif.latitude }),
        ...(exif.longitude != null && { longitude: exif.longitude }),
        ...(exif.city != null && { city: exif.city }),
        ...(exif.country != null && { country: exif.country }),
        ...(exif.takenAt != null && { taken_at: exif.takenAt }),
        ...(exif.takenAtOffset != null && { taken_at_offset: exif.takenAtOffset }),
        ...(exif.cameraMake != null && { camera_make: exif.cameraMake }),
        ...(exif.cameraModel != null && { camera_model: exif.cameraModel }),
        ...(exif.lensModel != null && { lens_model: exif.lensModel }),
        ...(exif.iso != null && { iso: exif.iso }),
        ...(exif.fNumber != null && { f_number: exif.fNumber }),
        ...(exif.exposureTime != null && { exposure_time: exif.exposureTime }),
        ...(exif.focalLength != null && { focal_length: exif.focalLength }),
        ...(exif.focalLength35mm != null && { focal_length_35mm: exif.focalLength35mm }),
        ...(exif.flashFired != null && { flash_fired: exif.flashFired }),
        ...(exif.orientation != null && { orientation: exif.orientation }),
        ...(exif.pixelWidth != null && { pixel_width: exif.pixelWidth }),
        ...(exif.pixelHeight != null && { pixel_height: exif.pixelHeight }),
    };

    return Object.keys(values).length === 0 ? null : values;
}
