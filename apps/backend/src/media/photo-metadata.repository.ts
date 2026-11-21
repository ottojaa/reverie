import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';

/** The photo_metadata columns a read of a stored file can fill: the EXIF facts of an image, and the place and date of a video. */
const FILLABLE = [
    'latitude',
    'longitude',
    'city',
    'country',
    'taken_at',
    'taken_at_offset',
    'camera_make',
    'camera_model',
    'lens_model',
    'iso',
    'f_number',
    'exposure_time',
    'focal_length',
    'focal_length_35mm',
    'flash_fired',
    'orientation',
    'pixel_width',
    'pixel_height',
] as const;

export type PhotoMetadataValues = Record<string, string | number | boolean | Date>;

/**
 * Stores the values in photo_metadata, keeping any column that already has a value (OCR may have stored it, and a value
 * that is there is never replaced). With no values it writes no row, so a screenshot stays without camera evidence.
 */
export async function fillMissingPhotoColumns(db: Kysely<Database>, documentId: string, values: PhotoMetadataValues | null): Promise<void> {
    if (!values) return;

    const keep = Object.fromEntries(
        FILLABLE.filter((column) => column in values).map((column) => [column, sql.raw(`coalesce(photo_metadata.${column}, excluded.${column})`)]),
    );

    await db
        .insertInto('photo_metadata')
        .values({ document_id: documentId, ...values })
        .onConflict((oc) => oc.column('document_id').doUpdateSet(keep))
        .execute();
}
