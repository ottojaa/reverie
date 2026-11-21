import sharp from 'sharp';

/**
 * A synthetic JPEG with exactly the EXIF tags a test names, so EXIF parsing is tested on real bytes without a
 * photograph in the repo. The image is a flat colour; the EXIF is written by hand (big-endian TIFF in an APP1
 * segment), so a tag a camera would omit is simply left out.
 */

type Rational = readonly [numerator: number, denominator: number];
type Value = string | number | Rational;

interface Tag {
    id: number;
    type: 'ascii' | 'short' | 'long' | 'rational';
    values: Value[];
}

export interface ExifFixture {
    make?: string;
    model?: string;
    /** TIFF orientation 1-8. */
    orientation?: number;
    lensModel?: string;
    /** 'YYYY:MM:DD HH:MM:SS', as cameras write it. */
    dateTimeOriginal?: string;
    /** 'YYYY:MM:DD HH:MM:SS', the date the file was digitised; the fallback when there is no original date. */
    dateTimeDigitized?: string;
    subSecTimeOriginal?: string;
    offsetTimeOriginal?: string;
    offsetTimeDigitized?: string;
    exposureTime?: Rational;
    fNumber?: Rational;
    iso?: number;
    focalLength?: Rational;
    focalLength35mm?: number;
    /** The raw EXIF flash bit field (bit 0: the flash fired). */
    flash?: number;
    pixelWidth?: number;
    pixelHeight?: number;
    gps?: { latitude: number; longitude: number };
}

const TYPE_CODE = { ascii: 2, short: 3, long: 4, rational: 5 } as const;
const TYPE_BYTES = { ascii: 1, short: 2, long: 4, rational: 8 } as const;

function toBytes(tag: Tag): Buffer {
    if (tag.type === 'ascii') return Buffer.from(`${tag.values[0] as string}\0`, 'latin1');

    const bytes = Buffer.alloc(tag.values.length * TYPE_BYTES[tag.type]);

    tag.values.forEach((value, index) => {
        if (tag.type === 'short') bytes.writeUInt16BE(value as number, index * 2);

        if (tag.type === 'long') bytes.writeUInt32BE(value as number, index * 4);

        if (tag.type === 'rational') {
            const [numerator, denominator] = value as Rational;

            bytes.writeUInt32BE(numerator, index * 8);
            bytes.writeUInt32BE(denominator, index * 8 + 4);
        }
    });

    return bytes;
}

/** Values longer than four bytes live after the entry table; the entry holds their offset. */
function ifdSize(tags: Tag[]): number {
    const spill = tags.reduce((sum, tag) => sum + (toBytes(tag).length > 4 ? toBytes(tag).length + (toBytes(tag).length % 2) : 0), 0);

    return 2 + tags.length * 12 + 4 + spill;
}

function encodeIfd(tags: Tag[], offset: number): Buffer {
    const sorted = [...tags].sort((a, b) => a.id - b.id);
    const table = Buffer.alloc(2 + sorted.length * 12 + 4);
    const spill: Buffer[] = [];
    let spillOffset = offset + table.length;

    table.writeUInt16BE(sorted.length, 0);

    sorted.forEach((tag, index) => {
        const entry = 2 + index * 12;
        const bytes = toBytes(tag);

        table.writeUInt16BE(tag.id, entry);
        table.writeUInt16BE(TYPE_CODE[tag.type], entry + 2);
        table.writeUInt32BE(tag.type === 'ascii' ? bytes.length : tag.values.length, entry + 4);

        if (bytes.length <= 4) {
            bytes.copy(table, entry + 8);

            return;
        }

        const padded = bytes.length % 2 === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(1)]);

        table.writeUInt32BE(spillOffset, entry + 8);
        spill.push(padded);
        spillOffset += padded.length;
    });

    return Buffer.concat([table, ...spill]);
}

function toDegreesMinutesSeconds(degrees: number): Rational[] {
    const absolute = Math.abs(degrees);
    const wholeDegrees = Math.floor(absolute);
    const minutes = (absolute - wholeDegrees) * 60;
    const wholeMinutes = Math.floor(minutes);

    return [
        [wholeDegrees, 1],
        [wholeMinutes, 1],
        [Math.round((minutes - wholeMinutes) * 60 * 10_000), 10_000],
    ];
}

function ascii(id: number, value: string | undefined): Tag[] {
    return value === undefined ? [] : [{ id, type: 'ascii', values: [value] }];
}

function short(id: number, value: number | undefined): Tag[] {
    return value === undefined ? [] : [{ id, type: 'short', values: [value] }];
}

function long(id: number, value: number | undefined): Tag[] {
    return value === undefined ? [] : [{ id, type: 'long', values: [value] }];
}

function rational(id: number, value: Rational | undefined): Tag[] {
    return value === undefined ? [] : [{ id, type: 'rational', values: [value] }];
}

function toTiff(fixture: ExifFixture): Buffer {
    const exifTags: Tag[] = [
        ...ascii(0x9003, fixture.dateTimeOriginal),
        ...ascii(0x9004, fixture.dateTimeDigitized),
        ...ascii(0x9011, fixture.offsetTimeOriginal),
        ...ascii(0x9012, fixture.offsetTimeDigitized),
        ...ascii(0x9291, fixture.subSecTimeOriginal),
        ...rational(0x829a, fixture.exposureTime),
        ...rational(0x829d, fixture.fNumber),
        ...short(0x8827, fixture.iso),
        ...rational(0x920a, fixture.focalLength),
        ...short(0xa405, fixture.focalLength35mm),
        ...short(0x9209, fixture.flash),
        ...long(0xa002, fixture.pixelWidth),
        ...long(0xa003, fixture.pixelHeight),
        ...ascii(0xa434, fixture.lensModel),
    ];
    const gpsTags: Tag[] = fixture.gps
        ? [
              ...ascii(0x0001, fixture.gps.latitude < 0 ? 'S' : 'N'),
              { id: 0x0002, type: 'rational', values: toDegreesMinutesSeconds(fixture.gps.latitude) },
              ...ascii(0x0003, fixture.gps.longitude < 0 ? 'W' : 'E'),
              { id: 0x0004, type: 'rational', values: toDegreesMinutesSeconds(fixture.gps.longitude) },
          ]
        : [];
    const hasExif = exifTags.length > 0;
    const hasGps = gpsTags.length > 0;
    const ifd0Pointers: Tag[] = [
        { id: 0x8769, type: 'long', values: [0] },
        { id: 0x8825, type: 'long', values: [0] },
    ].filter((tag) => (tag.id === 0x8769 ? hasExif : hasGps)) as Tag[];
    const ifd0Tags: Tag[] = [...ascii(0x010f, fixture.make), ...ascii(0x0110, fixture.model), ...short(0x0112, fixture.orientation), ...ifd0Pointers];
    const exifOffset = 8 + ifdSize(ifd0Tags);
    const gpsOffset = exifOffset + (hasExif ? ifdSize(exifTags) : 0);

    for (const pointer of ifd0Pointers) pointer.values = [pointer.id === 0x8769 ? exifOffset : gpsOffset];

    const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);

    return Buffer.concat([header, encodeIfd(ifd0Tags, 8), ...(hasExif ? [encodeIfd(exifTags, exifOffset)] : []), ...(hasGps ? [encodeIfd(gpsTags, gpsOffset)] : [])]);
}

/** A small valid JPEG carrying the given EXIF tags; with no tags at all it has no EXIF segment. */
export async function buildExifJpeg(fixture: ExifFixture = {}): Promise<Buffer> {
    const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 90, g: 120, b: 200 } } })
        .jpeg()
        .toBuffer();

    if (Object.keys(fixture).length === 0) return image;

    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), toTiff(fixture)]);
    const segment = Buffer.alloc(4);

    segment.writeUInt16BE(0xffe1, 0);
    segment.writeUInt16BE(payload.length + 2, 2);

    return Buffer.concat([image.subarray(0, 2), segment, payload, image.subarray(2)]);
}
