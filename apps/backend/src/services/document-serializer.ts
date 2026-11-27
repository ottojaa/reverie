import type { Document, DocumentPhotoMetadata, DocumentVideoMetadata } from '@reverie/shared';
import type { Document as DbDocument, LlmResult, PhotoMetadata, VideoMetadata } from '../db/schema.js';
import { formatDateOnly } from '../utils/date.js';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls.js';
import type { FolderLocks } from './folder-locks.js';
import { buildHlsMasterUrl } from './hls-url.js';
import { getStorageService } from './storage.service.js';

// Detail-only (GET /documents/:id): pass `photoMeta ?? null` (and `videoMeta ?? null`) to include the
// photo_metadata (video_metadata) field, null when no row exists; omit the arguments on list
// endpoints to leave the fields absent and avoid per-row joins.
// Only documents whose folder lock is open reach this point (callers check it first, see loadOpenDocument),
// so signed URLs are always safe to produce. Built field by field, never by spreading the
// row, so a column added to `documents` later is not exposed by accident.
export async function serializeDocument(
    doc: DbDocument & { taken_at?: Date | null; city?: string | null },
    locks: FolderLocks,
    llmResult?: LlmResult | null,
    photoMeta?: PhotoMetadata | null,
    videoMeta?: VideoMetadata | null,
): Promise<Document> {
    const storageService = getStorageService();
    const [fileUrl, thumbnailUrls] = await Promise.all([storageService.getFileUrl(doc.file_path), resolveThumbnailUrls(storageService, doc.thumbnail_paths)]);

    const serialized: Document = {
        id: doc.id,
        folder_id: doc.folder_id,
        file_path: doc.file_path,
        file_hash: doc.file_hash,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size_bytes: Number(doc.size_bytes),
        width: doc.width,
        height: doc.height,
        duration_seconds: doc.duration_seconds,
        thumbnail_blurhash: doc.thumbnail_blurhash,
        thumbnail_paths: doc.thumbnail_paths,
        document_category: doc.document_category as Document['document_category'],
        extracted_date: formatDateOnly(doc.extracted_date),
        ocr_status: doc.ocr_status as Document['ocr_status'],
        thumbnail_status: doc.thumbnail_status as Document['thumbnail_status'],
        llm_status: doc.llm_status,
        llm_summary: llmResult?.summary ?? null,
        llm_metadata: (llmResult?.metadata as Document['llm_metadata']) ?? null,
        llm_processed_at: llmResult?.processed_at?.toISOString() ?? null,
        llm_token_count: llmResult?.token_count ?? null,
        is_private: locks.isPrivate(doc.folder_id),
        ...takenAtOf(doc, photoMeta),
        ...cityOf(doc, photoMeta),
        created_at: doc.created_at.toISOString(),
        updated_at: doc.updated_at.toISOString(),
        file_url: fileUrl,
        hls_url: buildHlsMasterUrl(doc),
        thumbnail_urls: thumbnailUrls,
    };

    if (photoMeta === undefined) {
        return serialized;
    }

    return {
        ...serialized,
        photo_metadata: photoMeta ? toDocumentPhotoMetadata(photoMeta) : null,
        video_metadata: videoMeta ? toDocumentVideoMetadata(videoMeta) : null,
    };
}

/** `taken_at` as the API shows it; omitted when the row carries neither a listed value nor photo metadata. */
function takenAtOf(doc: { taken_at?: Date | null }, photoMeta: PhotoMetadata | null | undefined): Pick<Document, 'taken_at'> {
    const takenAt = photoMeta === undefined ? doc.taken_at : photoMeta?.taken_at;

    return takenAt === undefined ? {} : { taken_at: takenAt ? takenAt.toISOString() : null };
}

/** `city`, on the same terms as `taken_at`. */
function cityOf(doc: { city?: string | null }, photoMeta: PhotoMetadata | null | undefined): Pick<Document, 'city'> {
    const city = photoMeta === undefined ? doc.city : (photoMeta?.city ?? null);

    return city === undefined ? {} : { city: city || null };
}

function toDocumentVideoMetadata(videoMeta: VideoMetadata): DocumentVideoMetadata {
    return {
        container: videoMeta.container,
        video_codec: videoMeta.video_codec,
        video_profile: videoMeta.video_profile,
        audio_codec: videoMeta.audio_codec,
        bitrate: videoMeta.bitrate,
        width: videoMeta.width,
        height: videoMeta.height,
        frame_rate: videoMeta.frame_rate,
        rotation: videoMeta.rotation,
        color_transfer: videoMeta.color_transfer,
        is_hdr: videoMeta.is_hdr,
        creation_time: videoMeta.creation_time ? videoMeta.creation_time.toISOString() : null,
    };
}

function toDocumentPhotoMetadata(photoMeta: PhotoMetadata): DocumentPhotoMetadata {
    // Legacy rows may hold NaN coordinates (Postgres `real` stores NaN; a since-fixed
    // EXIF bug wrote them) — z.number() rejects NaN, which would 500 the response
    return {
        latitude: Number.isFinite(photoMeta.latitude) ? photoMeta.latitude : null,
        longitude: Number.isFinite(photoMeta.longitude) ? photoMeta.longitude : null,
        city: photoMeta.city || null,
        country: photoMeta.country || null,
        taken_at: photoMeta.taken_at ? photoMeta.taken_at.toISOString() : null,
        taken_at_offset: photoMeta.taken_at_offset,
        camera_make: photoMeta.camera_make,
        camera_model: photoMeta.camera_model,
        lens_model: photoMeta.lens_model,
        iso: photoMeta.iso,
        f_number: photoMeta.f_number,
        exposure_time: photoMeta.exposure_time,
        focal_length: photoMeta.focal_length,
        focal_length_35mm: photoMeta.focal_length_35mm,
        flash_fired: photoMeta.flash_fired,
        orientation: photoMeta.orientation,
        pixel_width: photoMeta.pixel_width,
        pixel_height: photoMeta.pixel_height,
    };
}
