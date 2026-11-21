import type { Kysely } from 'kysely';
import type { Database, JobStatus, TranscodeRungRecord } from '../db/schema';

export interface TranscodeSetRecord {
    files: string[];
    rungs: TranscodeRungRecord[];
    encoder: string;
    toneMap: string | null;
    totalBytes: number;
}

/** Where a set of renditions lives: the original's content hash is the key, so identical uploads share one set. */
export function toSetPrefix(fileHash: string): string {
    return `transcode/${fileHash}`;
}

export function toMasterPath(fileHash: string): string {
    return `${toSetPrefix(fileHash)}/master.m3u8`;
}

export async function findTranscodeSet(db: Kysely<Database>, fileHash: string): Promise<TranscodeSetRecord | null> {
    const row = await db.selectFrom('transcode_sets').selectAll().where('file_hash', '=', fileHash).executeTakeFirst();

    if (!row) return null;

    return { files: row.files, rungs: row.rungs, encoder: row.encoder, toneMap: row.tone_map, totalBytes: Number(row.total_bytes) };
}

/**
 * Written after every file of the set is stored, so a row means a complete set. A row that exists already is replaced:
 * a set is only encoded again when the stored one is known to be broken. The files it listed stay listed alongside the
 * new ones (some may be stored under names the new encode does not use), so a purge still removes all of them.
 */
export async function insertTranscodeSet(db: Kysely<Database>, fileHash: string, set: TranscodeSetRecord): Promise<void> {
    const previous = await findTranscodeSet(db, fileHash);
    const files = [...new Set([...(previous?.files ?? []), ...set.files])];
    // Stringified: pg would turn a JS array into a Postgres array, not JSON.
    const record = { files: JSON.stringify(files), rungs: JSON.stringify(set.rungs), encoder: set.encoder, tone_map: set.toneMap, total_bytes: set.totalBytes };

    await db
        .insertInto('transcode_sets')
        .values({ file_hash: fileHash, ...record })
        .onConflict((conflict) => conflict.column('file_hash').doUpdateSet(record))
        .execute();
}

/** Removes the set's row and returns the files it listed; null when there was no row. */
export async function deleteTranscodeSetRow(db: Kysely<Database>, fileHash: string): Promise<string[] | null> {
    const row = await db.deleteFrom('transcode_sets').where('file_hash', '=', fileHash).returning('files').executeTakeFirst();

    return row?.files ?? null;
}

/** Trashed documents count: they keep their file, and their renditions, until purged. `exceptDocumentId` leaves out the document being deleted or replaced. */
export async function hasDocumentWithHash(db: Kysely<Database>, fileHash: string, exceptDocumentId?: string): Promise<boolean> {
    const row = await db
        .selectFrom('documents')
        .select('id')
        .where('file_hash', '=', fileHash)
        .$if(exceptDocumentId !== undefined, (query) => query.where('id', '!=', exceptDocumentId!))
        .limit(1)
        .executeTakeFirst();

    return row !== undefined;
}

export async function setTranscodeStatus(db: Kysely<Database>, documentId: string, status: JobStatus): Promise<void> {
    await db.updateTable('documents').set({ transcode_status: status, updated_at: new Date() }).where('id', '=', documentId).execute();
}
