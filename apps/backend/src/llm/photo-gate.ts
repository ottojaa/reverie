import { db } from '../db/kysely';
import type { Document } from '../db/schema';
import { withholdsImageContent } from '../tools/photo';

/**
 * Whether an image must stay out of Claude vision: a photo (camera EXIF in photo_metadata, or the
 * 'photo' category) or an image the classifier has not looked at yet. When unsure it is a photo.
 * Non-images are never held back by this gate.
 */
export async function isHeldBackFromVision(document: Document): Promise<boolean> {
    if (!document.mime_type.startsWith('image/')) return false;

    // Uploads start without a category and OCR fills it in, so a job can reach an image before it is classified.
    if (document.document_category === null) return true;

    const exif = await db.selectFrom('photo_metadata').select(['taken_at', 'latitude', 'longitude']).where('document_id', '=', document.id).executeTakeFirst();

    return withholdsImageContent({
        mime_type: document.mime_type,
        document_category: document.document_category,
        taken_at: exif?.taken_at ?? null,
        latitude: exif?.latitude ?? null,
        longitude: exif?.longitude ?? null,
    });
}
