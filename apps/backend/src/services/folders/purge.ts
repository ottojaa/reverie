import type { Kysely } from 'kysely';
import { db } from '../../db/kysely.js';
import type { Database, Document, Folder } from '../../db/schema.js';
import { loadFolderTree } from './load.js';
import type { FolderTree } from './snapshot.js';
import { inFolderTransaction } from './transaction.js';

/**
 * Deleting trashed rows for good. The database cascades a folder delete to the folders beneath it and moves
 * their documents to the top level (ON DELETE SET NULL), which would make private documents public. So a
 * folder is only deleted when nothing beneath it has to survive, and its documents are deleted first.
 */

type DbOrTrx = Kysely<Database>;

/** Which trashed documents to delete: of one user, by id, and/or trashed before a cutoff. */
export interface DocumentPurgeScope {
    userId?: string;
    ids?: string[];
    olderThan?: Date;
    /** Only those that sit in one of these folders. */
    folderIds?: string[];
    /** Documents in these folders survive, such as folders under a closed lock. */
    exceptFolderIds?: string[];
}

export interface FolderPurgeScope {
    userId?: string | undefined;
    ids?: string[] | undefined;
    olderThan?: Date | undefined;
    /** Folders under a closed lock: they survive, and so does every folder above them. */
    lockedFolderIds?: string[] | undefined;
}

export interface FolderPurge {
    folders: number;
    /** The deleted document rows, whose files the caller removes once this has committed. */
    documents: Document[];
}

/**
 * One DELETE ... RETURNING decides what is purged, with the trashed and cutoff conditions inside it, so a
 * restore that lands in between can never be purged by mistake. Files are left to the caller.
 */
export async function deleteTrashedDocuments(trx: DbOrTrx, scope: DocumentPurgeScope): Promise<Document[]> {
    if (scope.ids?.length === 0 || scope.folderIds?.length === 0) return [];

    const rows = await trx
        .deleteFrom('documents')
        .where('deleted_at', 'is not', null)
        .$if(scope.userId !== undefined, (qb) => qb.where('user_id', '=', scope.userId!))
        .$if(scope.ids !== undefined, (qb) => qb.where('id', 'in', scope.ids!))
        .$if(scope.olderThan !== undefined, (qb) => qb.where('deleted_at', '<', scope.olderThan!))
        .$if(scope.folderIds !== undefined, (qb) => qb.where('folder_id', 'in', scope.folderIds!))
        .$if(scope.exceptFolderIds !== undefined && scope.exceptFolderIds.length > 0, (qb) =>
            qb.where((eb) => eb.or([eb('folder_id', 'is', null), eb('folder_id', 'not in', scope.exceptFolderIds!)])),
        )
        .returningAll()
        .execute();

    if (rows.length === 0) return rows;

    // processing_jobs.target_id is polymorphic (no foreign key), so clean it up by hand.
    await trx
        .deleteFrom('processing_jobs')
        .where('target_type', '=', 'document')
        .where(
            'target_id',
            'in',
            rows.map((row) => row.id),
        )
        .execute();

    return rows;
}

/** Whether a trashed row went to the trash early enough for this purge. */
function isExpired(row: { deleted_at: Date | null }, olderThan: Date | undefined): boolean {
    if (row.deleted_at === null) return false;

    return olderThan === undefined || row.deleted_at < olderThan;
}

/** Folders holding a document that has to survive: a live one, or one trashed after the cutoff. */
async function fetchFoldersWithSurvivors(trx: DbOrTrx, folderIds: string[], olderThan: Date | undefined): Promise<string[]> {
    const rows = await trx
        .selectFrom('documents')
        .select('folder_id')
        .distinct()
        .where('folder_id', 'in', folderIds)
        .where((eb) => eb.or([eb('deleted_at', 'is', null), ...(olderThan ? [eb('deleted_at', '>=', olderThan)] : [])]))
        .execute();

    return rows.map((row) => row.folder_id!);
}

function toSubtreeIds(tree: FolderTree<Folder>, roots: Folder[]): string[] {
    return Array.from(new Set(roots.flatMap((root) => tree.subtree(root.id, { trashed: true }).map((folder) => folder.id))));
}

async function purgeUserFolders(trx: DbOrTrx, userId: string, scope: FolderPurgeScope): Promise<FolderPurge> {
    const tree = await loadFolderTree(userId, trx);
    const wanted = scope.ids ? new Set(scope.ids) : null;
    const candidates = tree.all().filter((folder) => isExpired(folder, scope.olderThan) && (wanted?.has(folder.id) ?? true));

    if (candidates.length === 0) return { folders: 0, documents: [] };

    const kept = new Set([
        ...(scope.lockedFolderIds ?? []),
        ...tree
            .all()
            .filter((folder) => !isExpired(folder, scope.olderThan))
            .map((folder) => folder.id),
        ...(await fetchFoldersWithSurvivors(trx, toSubtreeIds(tree, candidates), scope.olderThan)),
    ]);
    const doomed = candidates.filter((root) => !tree.subtree(root.id, { trashed: true }).some((folder) => kept.has(folder.id)));

    if (doomed.length === 0) return { folders: 0, documents: [] };

    const folderIds = toSubtreeIds(tree, doomed);
    const documents = await deleteTrashedDocuments(trx, { userId, folderIds });

    await trx.deleteFrom('folders').where('id', 'in', folderIds).where('deleted_at', 'is not', null).execute();

    return { folders: doomed.length, documents };
}

async function fetchUsersWithTrashedFolders(): Promise<string[]> {
    const rows = await db.selectFrom('folders').select('user_id').distinct().where('deleted_at', 'is not', null).execute();

    return rows.map((row) => row.user_id);
}

/** Deletes trashed folders for good, with everything beneath them. One transaction per user. */
export async function purgeFolders(scope: FolderPurgeScope): Promise<FolderPurge> {
    if (scope.ids?.length === 0) return { folders: 0, documents: [] };

    const userIds = scope.userId === undefined ? await fetchUsersWithTrashedFolders() : [scope.userId];
    const purges: FolderPurge[] = [];

    for (const userId of userIds) purges.push(await inFolderTransaction(userId, (trx) => purgeUserFolders(trx, userId, scope)));

    return { folders: purges.reduce((sum, purge) => sum + purge.folders, 0), documents: purges.flatMap((purge) => purge.documents) };
}
