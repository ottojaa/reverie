import type { CheckContentRequest, CheckContentResult, ContentLocation } from '@reverie/shared';
import { db } from '../db/kysely.js';
import type { Folder } from '../db/schema.js';
import { loadFolderTree } from './folders/load.js';
import { toNamePath } from './folders/paths.js';
import type { FolderTree } from './folders/snapshot.js';
import { excludeTrashed } from './privacy.js';

/**
 * "Is this content already in the library?", asked by SHA-256 (the value stored as
 * `documents.file_hash`) so a client can check before uploading a single byte.
 *
 * Privacy: a match anywhere beneath a private folder is reported as `private` and nothing else,
 * whether or not the person has unlocked it, so the answer never depends on the session's locks and
 * never carries an id, name or path. The reply for a private or trashed match is built without
 * reading the row's location at all.
 */

interface ContentRow {
    folderId: string | null;
    filename: string;
    deleted: boolean;
}

/** Documents with these hashes, oldest first. */
async function loadRowsByHash(userId: string, hashes: string[]): Promise<Map<string, ContentRow[]>> {
    const byHash = new Map<string, ContentRow[]>();

    if (hashes.length === 0) return byHash;

    const rows = await db
        .selectFrom('documents')
        .select(['file_hash', 'folder_id', 'original_filename', 'deleted_at'])
        .where('user_id', '=', userId)
        .where('file_hash', 'in', hashes)
        .orderBy('created_at')
        .execute();

    for (const row of rows) {
        const entry: ContentRow = { folderId: row.folder_id, filename: row.original_filename, deleted: row.deleted_at !== null };

        byHash.set(row.file_hash, [...(byHash.get(row.file_hash) ?? []), entry]);
    }

    return byHash;
}

/** Filenames that already exist (live) in the target folder, or at the top level (null). */
async function loadFilenamesInFolder(userId: string, folderId: string | null, names: string[]): Promise<Set<string>> {
    const rows = await excludeTrashed(
        db
            .selectFrom('documents')
            .select('original_filename')
            .where('user_id', '=', userId)
            .where('folder_id', folderId === null ? 'is' : '=', folderId)
            .where('original_filename', 'in', names),
        '',
    ).execute();

    return new Set(rows.map((row) => row.original_filename));
}

function isPrivate(row: ContentRow, tree: FolderTree<Folder>): boolean {
    return row.folderId !== null && tree.lockOf(row.folderId) !== null;
}

/** The folder names of a public copy, from the top level down; null when it is in no folder. */
function toFolderNames(row: ContentRow, tree: FolderTree<Folder>): string[] | null {
    const folder = row.folderId === null ? undefined : tree.folder(row.folderId);

    return folder ? toNamePath(tree, folder) : null;
}

/** The best place to point at: an ordinary live copy (the one in the target folder first), else "private", else "trash". */
function toLocation(rows: ContentRow[], tree: FolderTree<Folder>, targetFolderId: string | null | undefined): ContentLocation | null {
    const live = rows.filter((row) => !row.deleted && !isPrivate(row, tree));
    const open = live.find((row) => row.folderId === targetFolderId) ?? live[0];

    if (open) return { where: 'folder', folder_path: toFolderNames(open, tree), filename: open.filename };

    if (rows.some((row) => isPrivate(row, tree))) return { where: 'private' };

    return rows.length > 0 ? { where: 'trash' } : null;
}

/** One result per requested file, in request order. The caller has already checked that the target folder is open. */
export async function checkContent(userId: string, request: CheckContentRequest): Promise<CheckContentResult[]> {
    const { files } = request;
    // The folder the files are headed for: an id, null for the top level, undefined when the request names none.
    const target = request.folder_id ?? (request.top_level ? null : undefined);
    const hashes = [...new Set(files.flatMap((file) => (file.sha256 ? [file.sha256.toLowerCase()] : [])))];
    const names = [...new Set(files.map((file) => file.name))];
    const [rowsByHash, tree, taken] = await Promise.all([
        loadRowsByHash(userId, hashes),
        loadFolderTree(userId),
        target === undefined ? new Set<string>() : loadFilenamesInFolder(userId, target, names),
    ]);

    return files.map((file) => {
        const sha256 = file.sha256?.toLowerCase() ?? null;

        return {
            name: file.name,
            sha256,
            content: sha256 ? toLocation(rowsByHash.get(sha256) ?? [], tree, target) : null,
            name_conflict: taken.has(file.name),
        };
    });
}
