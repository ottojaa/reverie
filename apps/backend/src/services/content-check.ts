import type { CheckContentRequest, CheckContentResult, ContentLocation } from '@reverie/shared';
import { db } from '../db/kysely.js';
import { excludeTrashed, loadLockMap, type LockMap } from './privacy.js';

/**
 * "Is this content already in the library?", asked by SHA-256 (the value stored as
 * `documents.file_hash`) so a client can check before uploading a single byte.
 *
 * Privacy: a match inside a private folder or collection is reported as `private` and nothing else,
 * whether or not the person has unlocked it, so the answer never depends on the session's locks and
 * never carries an id, name or path. The reply for a private or trashed match is built without
 * reading the row's location at all.
 */

interface ContentRow {
    folderId: string | null;
    filename: string;
    deleted: boolean;
    path: string | null;
}

/** Documents with these hashes, oldest first. The path comes from current names: `folders.path` goes stale when a collection is renamed. */
async function loadRowsByHash(userId: string, hashes: string[]): Promise<Map<string, ContentRow[]>> {
    const byHash = new Map<string, ContentRow[]>();

    if (hashes.length === 0) return byHash;

    const rows = await db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('folders as p', 'p.id', 'f.parent_id')
        .select(['d.file_hash', 'd.folder_id', 'd.original_filename', 'd.deleted_at', 'f.name as folder_name', 'p.name as parent_name'])
        .where('d.user_id', '=', userId)
        .where('d.file_hash', 'in', hashes)
        .orderBy('d.created_at')
        .execute();

    for (const row of rows) {
        const path = row.folder_name === null ? null : row.parent_name === null ? '/' + row.folder_name : '/' + row.parent_name + '/' + row.folder_name;
        const entry: ContentRow = { folderId: row.folder_id, filename: row.original_filename, deleted: row.deleted_at !== null, path };

        byHash.set(row.file_hash, [...(byHash.get(row.file_hash) ?? []), entry]);
    }

    return byHash;
}

/** Filenames that already exist (live) in the target folder. */
async function loadFilenamesInFolder(userId: string, folderId: string, names: string[]): Promise<Set<string>> {
    const rows = await excludeTrashed(
        db
            .selectFrom('documents')
            .select('original_filename')
            .where('user_id', '=', userId)
            .where('folder_id', '=', folderId)
            .where('original_filename', 'in', names),
        '',
    ).execute();

    return new Set(rows.map((row) => row.original_filename));
}

function isPrivate(row: ContentRow, lockMap: LockMap): boolean {
    return row.folderId !== null && lockMap.has(row.folderId);
}

/** The best place to point at: an ordinary live copy (the one in the target folder first), else "private", else "trash". */
function toLocation(rows: ContentRow[], lockMap: LockMap, targetFolderId: string | undefined): ContentLocation | null {
    const live = rows.filter((row) => !row.deleted && !isPrivate(row, lockMap));
    const open = live.find((row) => row.folderId === targetFolderId) ?? live[0];

    if (open) return { where: 'folder', folder_path: open.path, filename: open.filename };

    if (rows.some((row) => isPrivate(row, lockMap))) return { where: 'private' };

    return rows.length > 0 ? { where: 'trash' } : null;
}

/** One result per requested file, in request order. The caller has already checked that `folderId` is open. */
export async function checkContent(userId: string, request: CheckContentRequest): Promise<CheckContentResult[]> {
    const { folder_id: folderId, files } = request;
    const hashes = [...new Set(files.flatMap((file) => (file.sha256 ? [file.sha256.toLowerCase()] : [])))];
    const [rowsByHash, lockMap, taken] = await Promise.all([
        loadRowsByHash(userId, hashes),
        loadLockMap(userId),
        folderId ? loadFilenamesInFolder(userId, folderId, [...new Set(files.map((file) => file.name))]) : Promise.resolve(new Set<string>()),
    ]);

    return files.map((file) => {
        const sha256 = file.sha256?.toLowerCase() ?? null;

        return {
            name: file.name,
            sha256,
            content: sha256 ? toLocation(rowsByHash.get(sha256) ?? [], lockMap, folderId) : null,
            name_conflict: taken.has(file.name),
        };
    });
}
