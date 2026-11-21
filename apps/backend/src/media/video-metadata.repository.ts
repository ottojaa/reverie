import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { lookupPlace } from '../ocr/exif-extractor';
import { fillMissingPhotoColumns, type PhotoMetadataValues } from './photo-metadata.repository';
import type { VideoProbe } from './video-probe';

/** The place and date a video's tags give, as the photo_metadata columns photos use; null when the video has neither. */
async function toCaptureValues(capture: VideoProbe['capture']): Promise<PhotoMetadataValues | null> {
    const place = capture.latitude !== null && capture.longitude !== null ? await lookupPlace(capture.latitude, capture.longitude) : null;
    const values: PhotoMetadataValues = {
        ...(capture.latitude !== null && { latitude: capture.latitude }),
        ...(capture.longitude !== null && { longitude: capture.longitude }),
        ...(place?.city != null && { city: place.city }),
        ...(place?.country != null && { country: place.country }),
        ...(capture.takenAt !== null && { taken_at: capture.takenAt }),
        ...(capture.takenAtOffset !== null && { taken_at_offset: capture.takenAtOffset }),
    };

    return Object.keys(values).length === 0 ? null : values;
}

/**
 * Stores a video's ffprobe facts and marks the video read. The facts are a reading of the stored file, so a second probe
 * replaces the first; the place and date go to photo_metadata the way a photo's do, filling only empty columns.
 */
export async function saveVideoProbe(db: Kysely<Database>, documentId: string, probe: VideoProbe): Promise<void> {
    const { video } = probe;
    const facts = {
        container: video.container,
        video_codec: video.videoCodec,
        video_profile: video.videoProfile,
        pixel_format: video.pixelFormat,
        audio_codec: video.audioCodec,
        bitrate: video.bitrate,
        width: video.width,
        height: video.height,
        frame_rate: video.frameRate,
        rotation: video.rotation,
        color_transfer: video.colorTransfer,
        color_primaries: video.colorPrimaries,
        color_space: video.colorSpace,
        is_hdr: video.isHdr,
        creation_time: video.creationTime,
        processed_at: new Date(),
    };
    const capture = await toCaptureValues(probe.capture);

    await db
        .insertInto('video_metadata')
        .values({ document_id: documentId, ...facts })
        .onConflict((oc) => oc.column('document_id').doUpdateSet(facts))
        .execute();
    await fillMissingPhotoColumns(db, documentId, capture);
    await markMediaRead(db, documentId);
}

export function markMediaRead(db: Kysely<Database>, documentId: string): Promise<unknown> {
    return db
        .updateTable('documents')
        .set({ media_read_at: sql<Date>`now()` })
        .where('id', '=', documentId)
        .execute();
}
