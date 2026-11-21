import { db } from '../db/kysely';
import type { Document } from '../db/schema';
import type { ImageKind } from '../image-kind/kinds';
import { isKindFlipActive } from '../image-kind/service';
import { withholdsImageContent } from '../tools/photo';

/** The stored kind verdict of an image, or undefined when the classifier has not judged it. */
export async function loadKindVerdict(documentId: string): Promise<ImageKind | undefined> {
    const verdict = await db.selectFrom('document_image_kinds').select('kind').where('document_id', '=', documentId).executeTakeFirst();

    return verdict?.kind as ImageKind | undefined;
}

/**
 * Whether an image must stay out of Claude vision: a photo (camera evidence in photo_metadata, or the 'photo'
 * category) or an image with no kind verdict. When unsure it is a photo. Camera evidence holds an image back whatever
 * its kind. A lone capture date holds it back whenever its category comes from the OCR heuristics, which call a
 * phone-sized photo a screenshot: that is the flip off. With the flip on the verdict (photo-biased) decides the
 * category, so a dated image goes through. Non-images are never held back by this gate.
 */
export async function isHeldBackFromVision(document: Document, verdict: ImageKind | undefined, flip: boolean = isKindFlipActive()): Promise<boolean> {
    if (!document.mime_type.startsWith('image/')) return false;

    // Uploads start without a category and OCR fills it in, so a job can reach an image before it is classified.
    if (document.document_category === null || verdict === undefined) return true;

    const exif = await db
        .selectFrom('photo_metadata')
        .select(['taken_at', 'latitude', 'longitude', 'camera_make', 'camera_model', 'lens_model'])
        .where('document_id', '=', document.id)
        .executeTakeFirst();

    if (!flip && exif?.taken_at) return true;

    return withholdsImageContent({
        mime_type: document.mime_type,
        document_category: document.document_category,
        camera_read_at: document.camera_read_at,
        taken_at: exif?.taken_at ?? null,
        latitude: exif?.latitude ?? null,
        longitude: exif?.longitude ?? null,
        camera_make: exif?.camera_make ?? null,
        camera_model: exif?.camera_model ?? null,
        lens_model: exif?.lens_model ?? null,
    });
}
