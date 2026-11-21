import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { createWorkerLogger } from '../workers/worker.utils';
import { deleteTranscodeSetRow, hasDocumentWithHash } from './repository';

const logger = createWorkerLogger('Transcode');

/** The one storage call cleanup needs; the storage service has it. */
export interface TranscodeFileRemover {
    deleteFile: (path: string) => Promise<void>;
}

/**
 * Removes the renditions for a content hash when no document uses that hash any more (the last purge, or a replaced
 * file). Trashed documents still count, so the trash keeps renditions until it purges. A file that is already gone is
 * not an error: the delete is retried safely. `exceptDocumentId` is the document being purged or replaced, whose row may still exist. Returns whether a set was removed.
 */
export async function deleteTranscodeSetIfUnused(
    db: Kysely<Database>,
    storage: TranscodeFileRemover,
    fileHash: string,
    exceptDocumentId?: string,
): Promise<boolean> {
    if (await hasDocumentWithHash(db, fileHash, exceptDocumentId)) return false;

    const files = await deleteTranscodeSetRow(db, fileHash);

    if (files === null) return false;

    // master.m3u8 first: once it is gone nothing can start playing a set that is half deleted.
    const ordered = [...files].sort((a, b) => Number(b.endsWith('master.m3u8')) - Number(a.endsWith('master.m3u8')));

    for (const path of ordered) {
        await storage.deleteFile(path).catch((error: unknown) => {
            logger.warn('Could not delete a rendition file', { path, error: error instanceof Error ? error.message : String(error) });
        });
    }

    return true;
}
