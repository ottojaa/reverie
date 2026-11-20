import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Document, Folder } from '../db/schema';
import { getSetting } from '../settings/settings.service.js';
import { getDeduplicatedFilename } from '../utils/filename';
import { excludeTrashed, loadLockMap } from './privacy';
import { restoreFolder } from './trash-folders';
import { getUploadService } from './upload.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrashSelection {
    documentIds?: string[];
    folderIds?: string[];
}

export interface TrashResult {
    documents: number;
    folders: number;
}

export interface TrashListing {
    documents: Document[];
    folders: Folder[];
    retentionDays: number;
}

/** Which trashed rows a purge may delete: of one user, by id, and/or older than a cutoff. */
interface PurgeScope {
    userId?: string;
    ids?: string[];
    olderThan?: Date;
    /** Documents only: those that sit in one of these folders. */
    folderIds?: string[];
    /** Rows (documents by their folder, folders by id) that must survive, such as items under a closed lock. */
    exceptFolderIds?: string[];
}

export class TrashService {
    /** Move documents to the trash. Files stay where they are until the trash is purged. */
    async trashDocuments(userId: string, ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;

        const result = await excludeTrashed(
            db.updateTable('documents').set({ deleted_at: new Date() }).where('user_id', '=', userId).where('id', 'in', ids),
            '',
        ).executeTakeFirst();

        return Number(result.numUpdatedRows ?? 0);
    }

    /**
     * Restore documents to the folder they were in, or to the root when that folder is gone or
     * trashed. A filename that a live document in the folder has taken since gets the usual " (1)".
     */
    async restoreDocuments(userId: string, ids: string[]): Promise<number> {
        return db.transaction().execute((trx) => this.restoreDocumentsIn(trx, userId, ids));
    }

    private async restoreDocumentsIn(trx: Kysely<Database>, userId: string, ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;

        const docs = await trx
            .selectFrom('documents')
            .selectAll()
            .where('user_id', '=', userId)
            .where('id', 'in', ids)
            .where('deleted_at', 'is not', null)
            .execute();

        for (const doc of docs) await this.restoreDocument(trx, doc);

        return docs.length;
    }

    private async restoreDocument(trx: Kysely<Database>, doc: Document): Promise<void> {
        const folderId = await this.resolveRestoreFolder(trx, doc);
        const { deleted_at } = await trx.selectFrom('documents').select('deleted_at').where('id', '=', doc.id).executeTakeFirstOrThrow();

        // It came back together with its private folder.
        if (deleted_at === null) return;

        const taken = folderId
            ? await excludeTrashed(
                  trx.selectFrom('documents').select('original_filename').where('folder_id', '=', folderId).where('id', '!=', doc.id),
                  '',
              ).execute()
            : [];
        const filename = getDeduplicatedFilename(
            taken.map((row) => row.original_filename),
            doc.original_filename,
        );

        await trx.updateTable('documents').set({ deleted_at: null, folder_id: folderId, original_filename: filename }).where('id', '=', doc.id).execute();
    }

    /**
     * The folder a restored document goes back to. A trashed private folder is restored first
     * (with its collection) so the document is never left at the root, where it would be public;
     * a trashed public folder sends it to the root, as before.
     */
    private async resolveRestoreFolder(trx: Kysely<Database>, doc: Document): Promise<string | null> {
        if (!doc.folder_id) return null;

        const folder = await trx.selectFrom('folders').select(['id', 'deleted_at']).where('id', '=', doc.folder_id).executeTakeFirst();

        if (!folder) return null;

        if (!folder.deleted_at) return folder.id;

        if (!(await loadLockMap(doc.user_id, trx)).has(folder.id)) return null;

        await restoreFolder(doc.user_id, folder.id, trx);

        return folder.id;
    }

    /**
     * Restore a selection in one transaction, folders first: a document trashed from a folder that
     * was trashed later then lands back in it. An unknown id rolls the whole restore back.
     */
    async restore(userId: string, selection: TrashSelection): Promise<TrashResult> {
        const folderIds = selection.folderIds ?? [];

        return db.transaction().execute(async (trx) => {
            for (const id of folderIds) await restoreFolder(userId, id, trx);

            const documents = await this.restoreDocumentsIn(trx, userId, selection.documentIds ?? []);

            return { documents, folders: folderIds.length };
        });
    }

    async listTrash(userId: string): Promise<TrashListing> {
        const [documents, folders, retentionDays] = await Promise.all([
            db.selectFrom('documents').selectAll().where('user_id', '=', userId).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
            db.selectFrom('folders').selectAll().where('user_id', '=', userId).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
            getSetting('trash.retentionDays'),
        ]);
        const trashedAt = new Map(folders.map((folder) => [folder.id, folder.deleted_at?.getTime()]));
        // A folder trashed together with its collection is part of the collection's entry.
        const topLevel = folders.filter((folder) => !folder.parent_id || trashedAt.get(folder.parent_id) !== folder.deleted_at?.getTime());
        // Likewise a document trashed with its private folder (same timestamp) is part of the folder's entry.
        const standalone = documents.filter((doc) => !doc.folder_id || trashedAt.get(doc.folder_id) !== doc.deleted_at?.getTime());

        return { documents: standalone, folders: topLevel, retentionDays };
    }

    /**
     * Delete trashed items for good ("Delete forever"). Live items are never touched, and a folder
     * that contains a closed lock (`lockedFolderIds`) is left alone, since deleting it would delete the lock too.
     */
    async purge(userId: string, selection: TrashSelection, lockedFolderIds: string[] = []): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId, ids: selection.documentIds ?? [] });
        const folders = await this.purgeFolders({ userId, ids: selection.folderIds ?? [], exceptFolderIds: lockedFolderIds });

        return { documents, folders };
    }

    /**
     * Empty the trash. Items under a closed lock (`lockedFolderIds`) are left alone: the user cannot
     * see them, so they must not be destroyed on their behalf.
     */
    async emptyTrash(userId: string, lockedFolderIds: string[] = []): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId, exceptFolderIds: lockedFolderIds });
        const folders = await this.purgeFolders({ userId, exceptFolderIds: lockedFolderIds });

        return { documents, folders };
    }

    /** The retention job: purge everything trashed longer ago than `trash.retentionDays`. */
    async purgeExpired(now: Date = new Date()): Promise<TrashResult> {
        const olderThan = new Date(now.getTime() - (await getSetting('trash.retentionDays')) * DAY_MS);
        const documents = await this.purgeDocuments({ olderThan });
        const folders = await this.purgeFolders({ olderThan });

        return { documents, folders };
    }

    /**
     * One DELETE ... RETURNING decides what is purged, with the trashed/cutoff conditions inside
     * it, so a restore that lands in between can never be purged by mistake. Files are removed
     * afterwards from the returned rows, only through deleteDocumentFiles (shared files survive).
     */
    private async purgeDocuments(scope: PurgeScope): Promise<number> {
        if (scope.ids && scope.ids.length === 0) return 0;

        const purged = await db.transaction().execute(async (trx) => {
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

            // processing_jobs.target_id is polymorphic (no foreign key), so clean it up by hand.
            if (rows.length > 0) {
                await trx
                    .deleteFrom('processing_jobs')
                    .where('target_type', '=', 'document')
                    .where(
                        'target_id',
                        'in',
                        rows.map((row) => row.id),
                    )
                    .execute();
            }

            return rows;
        });

        const uploadService = getUploadService();

        for (const doc of purged) {
            try {
                await uploadService.deleteDocumentFiles(doc, doc.user_id);
            } catch (err) {
                console.error('Failed to delete file from storage:', err);
            }
        }

        return purged.length;
    }

    /**
     * documents.folder_id is ON DELETE SET NULL and folders.parent_id is ON DELETE CASCADE, so deleting
     * a folder silently deletes its child folders and drops their documents to the root. A private
     * folder's trashed documents are therefore purged first, for every folder the delete will remove,
     * and a folder is skipped when the delete would cascade into a lock that must survive.
     */
    private async purgeFolders(scope: PurgeScope): Promise<number> {
        if (scope.ids && scope.ids.length === 0) return 0;

        const exceptIds = scope.exceptFolderIds ?? [];
        const selected = await db
            .selectFrom('folders')
            .select(['id', 'user_id'])
            .where('deleted_at', 'is not', null)
            .$if(scope.userId !== undefined, (qb) => qb.where('user_id', '=', scope.userId!))
            .$if(scope.ids !== undefined, (qb) => qb.where('id', 'in', scope.ids!))
            .$if(scope.olderThan !== undefined, (qb) => qb.where('deleted_at', '<', scope.olderThan!))
            .$if(exceptIds.length > 0, (qb) => qb.where('id', 'not in', exceptIds))
            .execute();
        const spared = await this.fetchParentIds(exceptIds);
        const candidates = selected.filter((folder) => !spared.has(folder.id));

        if (candidates.length === 0) return 0;

        const candidateIds = candidates.map((folder) => folder.id);
        const cascaded = await db.selectFrom('folders').select(['id', 'user_id']).where('parent_id', 'in', candidateIds).execute();

        await this.purgePrivateDocumentsOf([...candidates, ...cascaded]);

        const rows = await db
            .deleteFrom('folders')
            .where('id', 'in', candidateIds)
            .where('deleted_at', 'is not', null)
            .$if(scope.olderThan !== undefined, (qb) => qb.where('deleted_at', '<', scope.olderThan!))
            .returning('id')
            .execute();

        return rows.length;
    }

    /** Parents of the given folders: deleting one of these would cascade into a folder that has to survive. */
    private async fetchParentIds(folderIds: string[]): Promise<Set<string>> {
        if (folderIds.length === 0) return new Set();

        const rows = await db.selectFrom('folders').select('parent_id').where('id', 'in', folderIds).where('parent_id', 'is not', null).execute();

        return new Set(rows.map((row) => row.parent_id!));
    }

    private async purgePrivateDocumentsOf(folders: Array<{ id: string; user_id: string }>): Promise<void> {
        for (const userId of new Set(folders.map((folder) => folder.user_id))) {
            const lockMap = await loadLockMap(userId);
            const privateIds = folders.filter((folder) => folder.user_id === userId && lockMap.has(folder.id)).map((folder) => folder.id);

            if (privateIds.length > 0) await this.purgeDocuments({ userId, folderIds: privateIds });
        }
    }
}

let trashServiceInstance: TrashService | null = null;

export function getTrashService(): TrashService {
    if (!trashServiceInstance) {
        trashServiceInstance = new TrashService();
    }

    return trashServiceInstance;
}
