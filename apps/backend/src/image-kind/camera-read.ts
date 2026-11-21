import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { extractExifMetadata, toPhotoMetadataValues } from '../ocr/exif-extractor';

/**
 * Filling an image's camera columns (make, model, lens, GPS, capture date) from its stored file, for images stored
 * before those columns were read, without running OCR again. `documents.camera_read_at` marks the images already read.
 */

export type CameraReadOutcome = 'read' | 'no-document' | 'no-image' | 'no-file';

export interface CameraReadDeps {
    db: Kysely<Database>;
    readFile: (path: string) => Promise<Buffer>;
}

/** The photo_metadata columns an EXIF read can fill. */
const FILLABLE = ['latitude', 'longitude', 'city', 'country', 'taken_at', 'camera_make', 'camera_model', 'lens_model'] as const;

/** A file that is not there will not appear by retrying: the image is marked read with nothing found. */
function isMissingFile(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Stores the EXIF values in photo_metadata, keeping any column that already has a value (OCR may have stored it, and a
 * value that is there is never replaced). With nothing to store it writes no row.
 */
async function fillMissingColumns(db: Kysely<Database>, documentId: string, values: Record<string, string | number | Date>): Promise<void> {
    const keep = Object.fromEntries(
        FILLABLE.filter((column) => column in values).map((column) => [column, sql.raw(`coalesce(photo_metadata.${column}, excluded.${column})`)]),
    );

    await db
        .insertInto('photo_metadata')
        .values({ document_id: documentId, ...values })
        .onConflict((oc) => oc.column('document_id').doUpdateSet(keep))
        .execute();
}

/**
 * Reads the image's EXIF from its stored file, fills the camera columns that are empty, and marks the image read.
 * Safe to repeat: values already stored are kept, so a second run changes nothing. A missing file marks the image read
 * with nothing found; any other failure throws and the queue retries.
 */
export async function readDocumentCamera(deps: CameraReadDeps, documentId: string): Promise<CameraReadOutcome> {
    const { db, readFile } = deps;
    const document = await db.selectFrom('documents').select(['file_path', 'mime_type']).where('id', '=', documentId).executeTakeFirst();

    if (!document) return 'no-document';

    if (!document.mime_type.startsWith('image/')) return 'no-image';

    const markRead = () =>
        db
            .updateTable('documents')
            .set({ camera_read_at: sql<Date>`now()` })
            .where('id', '=', documentId)
            .execute();
    let buffer: Buffer;

    try {
        buffer = await readFile(document.file_path);
    } catch (error) {
        if (!isMissingFile(error)) throw error;

        await markRead();

        return 'no-file';
    }

    const values = toPhotoMetadataValues(await extractExifMetadata(buffer));

    if (values) await fillMissingColumns(db, documentId, values);

    await markRead();

    return 'read';
}

/** Live images whose camera columns have not been read from their file, in id order, after `after`. */
export async function findDocumentsMissingCameraRead(db: Kysely<Database>, after: string | null, limit: number): Promise<string[]> {
    const rows = await db
        .selectFrom('documents as d')
        .select('d.id')
        .where('d.deleted_at', 'is', null)
        .where('d.mime_type', 'like', 'image/%')
        .where('d.camera_read_at', 'is', null)
        .$if(after !== null, (qb) => qb.where('d.id', '>', after!))
        .orderBy('d.id')
        .limit(limit)
        .execute();

    return rows.map((row) => row.id);
}
