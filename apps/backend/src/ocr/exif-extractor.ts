import { createRevGeocoder } from '@webkitty/geo-rev';
import exifr from 'exifr';

export interface ExifMetadata {
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    country: string | null;
    takenAt: Date | null;
}

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

export async function extractExifMetadata(buffer: Buffer): Promise<ExifMetadata> {
    const result: ExifMetadata = {
        latitude: null,
        longitude: null,
        city: null,
        country: null,
        takenAt: null,
    };

    try {
        const exif = await exifr.parse(buffer, {
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'DateTimeOriginal', 'CreateDate'],
            translateValues: true,
        });

        if (!exif) return result;

        if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
            result.latitude = exif.latitude;
            result.longitude = exif.longitude;

            const geocoder = await getGeocoder();
            const geo = geocoder.lookup({ latitude: exif.latitude, longitude: exif.longitude });

            if (geo?.record) {
                result.city = geo.record.name;
                result.country = countryCodeToName(geo.record.countryCode);
            }
        }

        const dateValue = exif.DateTimeOriginal ?? exif.CreateDate;

        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            result.takenAt = dateValue;
        }
    } catch {
        // EXIF parsing failures are non-fatal
    }

    return result;
}
