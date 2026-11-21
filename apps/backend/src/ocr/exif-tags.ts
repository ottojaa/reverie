/**
 * Reading the exposure and time tags of an EXIF block (as exifr returns them with `translateValues` and
 * `reviveValues` off: numbers stay numbers, dates stay strings). Kept apart from the extractor so each reader is a
 * pure function of the parsed tags.
 */

export type ExifTags = Record<string, unknown>;

/** The tags these readers need, for exifr's `pick`. */
export const EXPOSURE_AND_TIME_TAGS = [
    'DateTimeOriginal',
    'CreateDate',
    'SubSecTimeOriginal',
    'SubSecTimeDigitized',
    'OffsetTimeOriginal',
    'OffsetTimeDigitized',
    'ISO',
    'FNumber',
    'ExposureTime',
    'FocalLength',
    'FocalLengthIn35mmFormat',
    'Flash',
    'Orientation',
    'ExifImageWidth',
    'ExifImageHeight',
    'ImageWidth',
    'ImageHeight',
];

export interface ExposureFacts {
    iso: number | null;
    fNumber: number | null;
    /** Seconds. */
    exposureTime: number | null;
    /** Millimetres. */
    focalLength: number | null;
    focalLength35mm: number | null;
    flashFired: boolean | null;
    /** 1-8. */
    orientation: number | null;
    pixelWidth: number | null;
    pixelHeight: number | null;
}

/** A finite number above zero; cameras write 0 for "unknown" in several of these tags. */
function toPositive(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function toPositiveInteger(value: unknown): number | null {
    const number = toPositive(value);

    return number === null ? null : Math.round(number);
}

/** The flash tag is a bit field; bit 0 says the flash fired. */
function toFlashFired(value: unknown): boolean | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;

    return (value & 1) === 1;
}

function toOrientation(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;
}

export function readExposureFacts(exif: ExifTags): ExposureFacts {
    return {
        iso: toPositiveInteger(exif['ISO']),
        fNumber: toPositive(exif['FNumber']),
        exposureTime: toPositive(exif['ExposureTime']),
        focalLength: toPositive(exif['FocalLength']),
        focalLength35mm: toPositive(exif['FocalLengthIn35mmFormat']),
        flashFired: toFlashFired(exif['Flash']),
        orientation: toOrientation(exif['Orientation']),
        pixelWidth: toPositiveInteger(exif['ExifImageWidth'] ?? exif['ImageWidth']),
        pixelHeight: toPositiveInteger(exif['ExifImageHeight'] ?? exif['ImageHeight']),
    };
}

const EXIF_DATE = /^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const UTC_OFFSET = /^([+-])(0\d|1[0-4]):([0-5]\d)$/;

/** The clock reading in an EXIF date string as if it were UTC, so the value does not depend on the server's time zone. */
export function parseExifClock(value: unknown, subSeconds?: unknown): Date | null {
    const match = typeof value === 'string' ? EXIF_DATE.exec(value.trim()) : null;

    if (!match) return null;

    const [year, month, day, hours, minutes, seconds] = match.slice(1).map(Number) as [number, number, number, number, number, number];
    const millis = typeof subSeconds === 'string' && /^\d+$/.test(subSeconds.trim()) ? Number(subSeconds.trim().padEnd(3, '0').slice(0, 3)) : 0;
    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, millis));
    const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hours;

    return isReal ? date : null;
}

/** '+02:00' when the tag holds a plausible UTC offset, else null. */
export function parseUtcOffset(value: unknown): string | null {
    return typeof value === 'string' && UTC_OFFSET.test(value.trim()) ? value.trim() : null;
}

export interface CaptureTime {
    takenAt: Date | null;
    /** The offset the clock was in, when the file says so. */
    takenAtOffset: string | null;
}

/** The original capture time with its UTC offset, falling back to the digitised time (and its own offset tag). */
export function readCaptureTime(exif: ExifTags): CaptureTime {
    const original = parseExifClock(exif['DateTimeOriginal'], exif['SubSecTimeOriginal']);

    if (original) return { takenAt: original, takenAtOffset: parseUtcOffset(exif['OffsetTimeOriginal']) };

    const digitised = parseExifClock(exif['CreateDate'], exif['SubSecTimeDigitized']);

    return { takenAt: digitised, takenAtOffset: digitised ? parseUtcOffset(exif['OffsetTimeDigitized']) : null };
}
