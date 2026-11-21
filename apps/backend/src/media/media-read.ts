import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { extractExifMetadata, toPhotoMetadataValues } from '../ocr/exif-extractor';
import { fillMissingPhotoColumns } from './photo-metadata.repository';
import { markMediaRead, saveVideoProbe } from './video-metadata.repository';
import { VideoUnreadableError, type VideoProbe } from './video-probe';

/**
 * Filling an image's EXIF columns, or a video's ffprobe facts, from the stored file, for media stored before those facts
 * were read, without running OCR or a thumbnail again. `documents.media_read_at` marks what was read. An image's
 * `camera_read_at` is the older marker the photo-or-screenshot rules read: it is set here only when still empty.
 */

/**
 * - `read`: an image whose camera columns had not been read before; the caller classifies it again with the new facts.
 * - `no-file`: the same, but its file is gone (marked read with nothing found).
 * - `refreshed`: an image that already had its camera columns read; only the newer EXIF columns were filled, so there is nothing to classify again.
 * - `video`: a video, probed or unreadable (marked read).
 */
export type MediaReadOutcome = 'read' | 'no-file' | 'refreshed' | 'video' | 'no-document' | 'no-media';

export interface MediaReadDeps {
    db: Kysely<Database>;
    readFile: (path: string) => Promise<Buffer>;
    /** Probes a stored video by path (never loading it into memory); throws an ENOENT error when the file is missing. */
    probeVideo: (path: string, mimeType: string) => Promise<VideoProbe>;
}

/** A file that is not there will not appear by retrying: the media is marked read with nothing found. */
function isMissingFile(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

interface ReadTarget {
    id: string;
    file_path: string;
    mime_type: string;
    camera_read_at: Date | null;
}

async function readVideo(deps: MediaReadDeps, document: ReadTarget): Promise<MediaReadOutcome> {
    try {
        await saveVideoProbe(deps.db, document.id, await deps.probeVideo(document.file_path, document.mime_type));
    } catch (error) {
        // A missing or unparseable file will not improve by retrying: mark it read with nothing found.
        if (!isMissingFile(error) && !(error instanceof VideoUnreadableError)) throw error;

        await markMediaRead(deps.db, document.id);
    }

    return 'video';
}

/** Marks an image's EXIF as read: `camera_read_at` only the first time, so the photo-or-screenshot rules see no change. */
function markImageRead(db: Kysely<Database>, documentId: string): Promise<unknown> {
    return db
        .updateTable('documents')
        .set({ media_read_at: sql<Date>`now()`, camera_read_at: sql<Date>`coalesce(camera_read_at, now())` })
        .where('id', '=', documentId)
        .execute();
}

async function readImage(deps: MediaReadDeps, document: ReadTarget): Promise<MediaReadOutcome> {
    const { db, readFile } = deps;
    const first = document.camera_read_at === null;
    let buffer: Buffer;

    try {
        buffer = await readFile(document.file_path);
    } catch (error) {
        if (!isMissingFile(error)) throw error;

        await markImageRead(db, document.id);

        return first ? 'no-file' : 'refreshed';
    }

    await fillMissingPhotoColumns(db, document.id, toPhotoMetadataValues(await extractExifMetadata(buffer)));
    await markImageRead(db, document.id);

    return first ? 'read' : 'refreshed';
}

/**
 * Reads the stored file of an image (EXIF) or a video (ffprobe), fills the columns that are empty, and marks it read.
 * Safe to repeat: image values already stored are kept and a video's facts are replaced by the same reading, so a second
 * run changes nothing. A missing file marks the media read with nothing found; any other failure throws and the queue retries.
 */
export async function readDocumentMedia(deps: MediaReadDeps, documentId: string): Promise<MediaReadOutcome> {
    const document = await deps.db
        .selectFrom('documents')
        .select(['id', 'file_path', 'mime_type', 'camera_read_at'])
        .where('id', '=', documentId)
        .executeTakeFirst();

    if (!document) return 'no-document';

    if (document.mime_type.startsWith('image/')) return readImage(deps, document);

    if (document.mime_type.startsWith('video/')) return readVideo(deps, document);

    return 'no-media';
}

/** Live images and videos whose file has not been read for EXIF or video facts, in id order, after `after`. */
export async function findDocumentsMissingMediaRead(db: Kysely<Database>, after: string | null, limit: number): Promise<string[]> {
    const rows = await db
        .selectFrom('documents as d')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .where((eb) => eb.or([eb('d.mime_type', 'like', 'image/%'), eb('d.mime_type', 'like', 'video/%')]))
        .where('d.media_read_at', 'is', null)
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}
