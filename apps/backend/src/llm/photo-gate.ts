import { db } from '../db/kysely';
import type { Document } from '../db/schema';
import { getMlClient, type MlClient } from '../embeddings/ml.client';
import type { ImageKind } from '../image-kind/kinds';
import { isKindFlipActive, isMlServing } from '../image-kind/service';
import { withholdsImageContent } from '../tools/photo';

/** The flip's part of the gate: whether verdicts decide categories, and the ML service whose availability says whether one can exist. */
export interface KindGate {
    flip: boolean;
    ml: MlClient | null;
}

const defaultKindGate = (): KindGate => ({ flip: isKindFlipActive(), ml: getMlClient() });

/** The stored kind verdict of an image, or undefined when the classifier has not judged it. */
export async function loadKindVerdict(documentId: string): Promise<ImageKind | undefined> {
    const verdict = await db.selectFrom('document_image_kinds').select('kind').where('document_id', '=', documentId).executeTakeFirst();

    return verdict?.kind as ImageKind | undefined;
}

/** With the flip on and reverie-ml serving, an image whose kind is not decided yet is not looked at. */
async function isAwaitingKind({ flip, ml }: KindGate, verdict: ImageKind | undefined): Promise<boolean> {
    if (verdict !== undefined || !flip || !ml) return false;

    return isMlServing(ml);
}

/**
 * Whether an image must stay out of Claude vision: a photo (camera evidence in photo_metadata, or the
 * 'photo' category) or an image the classifier has not looked at yet. When unsure it is a photo.
 * With the image-kind flip on, "not looked at" also means no kind verdict yet while reverie-ml is serving, whatever
 * category the OCR heuristics gave. Camera evidence holds an image back whatever its kind, in both modes.
 * A lone capture date holds an image back whenever its category comes from the OCR heuristics, which call a phone-sized
 * photo a screenshot: that is the flip off, or no verdict (reverie-ml down, or the image not classified yet). Only a stored
 * verdict with the flip on lets a dated image through. Non-images are never held back by this gate.
 */
export async function isHeldBackFromVision(document: Document, kindGate: KindGate = defaultKindGate()): Promise<boolean> {
    if (!document.mime_type.startsWith('image/')) return false;

    // Uploads start without a category and OCR fills it in, so a job can reach an image before it is classified.
    if (document.document_category === null) return true;

    const verdict = await loadKindVerdict(document.id);

    if (await isAwaitingKind(kindGate, verdict)) return true;

    const exif = await db
        .selectFrom('photo_metadata')
        .select(['taken_at', 'latitude', 'longitude', 'camera_make', 'camera_model', 'lens_model'])
        .where('document_id', '=', document.id)
        .executeTakeFirst();

    // Without a verdict applied to the category the OCR heuristics decide it, and they call a phone-sized photo a
    // screenshot, so a capture date still holds the image back. With a verdict the classifier (photo-biased) decides.
    const categoryFromVerdict = kindGate.flip && verdict !== undefined;

    if (!categoryFromVerdict && exif?.taken_at) return true;

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
