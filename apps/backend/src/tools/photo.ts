import { sql, type RawBuilder, type SqlBool } from 'kysely';

/**
 * What counts as a photo, in one place.
 *
 * A photo is an image with camera EXIF: a capture date or a GPS position in photo_metadata.
 * Screenshots and scans carry neither, so they are not photos. The q-DSL's `category:photo` is a
 * different thing: the OCR classifier's label for any image without meaningful text, with or
 * without EXIF.
 *
 * For photos the tools return filename, dates, place and tags only. The summary of an image is a
 * description of the picture, so it, the entities and the OCR text stay hidden, and so does
 * anything that would let a search confirm them.
 */

export interface PhotoFacts {
    mime_type: string;
    taken_at: Date | null;
    latitude: number | null;
    longitude: number | null;
}

export interface ImageContentFacts extends PhotoFacts {
    document_category: string | null;
}

function isCoordinate(value: number | null): boolean {
    return value !== null && Number.isFinite(Number(value));
}

/** An `image/*` document with a capture date or a GPS position. */
export function isPhoto(facts: PhotoFacts): boolean {
    if (!facts.mime_type.startsWith('image/')) return false;

    return facts.taken_at !== null || (isCoordinate(facts.latitude) && isCoordinate(facts.longitude));
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
export function isPhotoSql(): RawBuilder<SqlBool> {
    return sql<SqlBool>`(d.mime_type LIKE 'image/%' AND (pm.taken_at IS NOT NULL OR (pm.latitude IS NOT NULL AND pm.longitude IS NOT NULL)))`;
}

export function withholdsImageContentSql(): RawBuilder<SqlBool> {
    return sql<SqlBool>`(${isPhotoSql()} OR (d.mime_type LIKE 'image/%' AND d.document_category = 'photo'))`;
}

/** The date a document is shown with (see toDisplayDate): a withheld image gets its capture date only. */
export function shownDateSql(): RawBuilder<Date | null> {
    return sql<Date | null>`(CASE WHEN ${withholdsImageContentSql()} THEN pm.taken_at::date ELSE coalesce(d.extracted_date, pm.taken_at::date) END)`;
}
