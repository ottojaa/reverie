import { sql, type RawBuilder, type SqlBool } from 'kysely';

/**
 * What counts as a photo, in one place.
 *
 * A photo is an image with camera evidence: a camera make, model or lens, or a GPS position, in photo_metadata. A
 * capture date alone is not evidence: Android writes one into every screenshot and many apps keep it when saving
 * an image. Screenshots and scans carry no camera evidence, so they are not photos. The q-DSL's `category:photo`
 * is a different thing: the OCR classifier's label for any image without meaningful text, with or without EXIF.
 *
 * Until an image's camera columns have been read from its file (`documents.camera_read_at` is null) a capture date
 * still counts: its make and model may simply not be stored yet, and unsure means photo. The date stops counting
 * once the read has found no camera evidence.
 *
 * For photos the tools return filename, dates, place and tags only. The summary of an image is a
 * description of the picture, so it, the entities and the OCR text stay hidden, and so does
 * anything that would let a search confirm them.
 */

export interface CameraFacts {
    latitude: number | null;
    longitude: number | null;
    camera_make: string | null;
    camera_model: string | null;
    lens_model: string | null;
}

export interface CameraBackedFacts extends CameraFacts {
    taken_at: Date | null;
    /** documents.camera_read_at: null while the camera columns have not been read from the file. */
    camera_read_at: Date | null;
}

export interface PhotoFacts extends CameraBackedFacts {
    mime_type: string;
}

export interface ImageContentFacts extends PhotoFacts {
    document_category: string | null;
}

function isCoordinate(value: number | null): boolean {
    return value !== null && Number.isFinite(Number(value));
}

function isText(value: string | null): boolean {
    return value !== null && value !== '';
}

/** Camera evidence: make, model, lens or a GPS position. The one definition the photo rules and the image-kind classifier share. */
export function hasCameraEvidence(facts: CameraFacts): boolean {
    return (
        isText(facts.camera_make) || isText(facts.camera_model) || isText(facts.lens_model) || (isCoordinate(facts.latitude) && isCoordinate(facts.longitude))
    );
}

/** Camera evidence, or a capture date whose camera columns have not been read yet to confirm or refute it. */
export function isCameraBacked(facts: CameraBackedFacts): boolean {
    return hasCameraEvidence(facts) || (facts.taken_at !== null && facts.camera_read_at === null);
}

/** An `image/*` document that is camera-backed. */
export function isPhoto(facts: PhotoFacts): boolean {
    return facts.mime_type.startsWith('image/') && isCameraBacked(facts);
}

/**
 * Whether the tools must hide the content-derived fields (summary, entities, OCR text) and keep
 * content out of search matching. A photo, plus any image the classifier labelled 'photo' even
 * without EXIF, because its summary is still a description of the picture. A screenshot or scan
 * without EXIF keeps its content.
 */
export function withholdsImageContent(facts: ImageContentFacts): boolean {
    return isPhoto(facts) || (facts.mime_type.startsWith('image/') && facts.document_category === 'photo');
}

/**
 * SQL forms of the two functions above, over the search aliases `d` (documents) and `pm`
 * (photo_metadata). A test checks them against the functions on the same fixtures, so they cannot drift.
 */
export function hasCameraEvidenceSql(): RawBuilder<SqlBool> {
    return sql<SqlBool>`(nullif(pm.camera_make, '') IS NOT NULL OR nullif(pm.camera_model, '') IS NOT NULL OR nullif(pm.lens_model, '') IS NOT NULL OR (pm.latitude IS NOT NULL AND pm.longitude IS NOT NULL))`;
}

export function isPhotoSql(): RawBuilder<SqlBool> {
    return sql<SqlBool>`(d.mime_type LIKE 'image/%' AND (${hasCameraEvidenceSql()} OR (pm.taken_at IS NOT NULL AND d.camera_read_at IS NULL)))`;
}

export function withholdsImageContentSql(): RawBuilder<SqlBool> {
    return sql<SqlBool>`(${isPhotoSql()} OR (d.mime_type LIKE 'image/%' AND d.document_category = 'photo'))`;
}

/**
 * The date a document is shown with (see toDisplayDate): a withheld image gets its capture date only.
 * `taken_at` is the camera's clock reading stored as if it were UTC, so its day is read in UTC: a bare
 * `::date` would move it to the next or previous day in a database session set to another time zone.
 */
export function shownDateSql(): RawBuilder<Date | null> {
    const captured = sql`(pm.taken_at AT TIME ZONE 'UTC')::date`;

    return sql<Date | null>`(CASE WHEN ${withholdsImageContentSql()} THEN ${captured} ELSE coalesce(d.extracted_date, ${captured}) END)`;
}
