import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Document, Folder } from '../db/schema';
import { getSetting } from '../settings/settings.service.js';
import { getDeduplicatedFilename } from '../utils/filename';
import { loadFolderTree } from './folders/load.js';
import { deleteTrashedDocuments, purgeFolders, type DocumentPurgeScope, type FolderPurgeScope } from './folders/purge.js';
import { isUnitRoot, restoreFolder, toUnitCounts, type TrashUnitCounts } from './folders/trash.js';
import { excludeTrashed, loadLockMap } from './privacy';
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
    /** Documents trashed on their own: the ones trashed with a folder are part of that folder's entry. */
    documents: Document[];
    /** One entry per trashed unit: the folder at its top, with what went to the trash with it. */
    folders: Array<Folder & TrashUnitCounts>;
    retentionDays: number;
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

        const taken = await excludeTrashed(
            trx
                .selectFrom('documents')
                .select('original_filename')
                .where('user_id', '=', doc.user_id)
                .where('folder_id', folderId === null ? 'is' : '=', folderId)
                .where('id', '!=', doc.id),
            '',
        ).execute();
        const filename = getDeduplicatedFilename(
            taken.map((row) => row.original_filename),
            doc.original_filename,
        );

        await trx.updateTable('documents').set({ deleted_at: null, folder_id: folderId, original_filename: filename }).where('id', '=', doc.id).execute();
    }

    /**
     * The folder a restored document goes back to. A trashed private folder is restored first
     * (with the folders above it) so the document is never left at the top level, where it would be
     * public; a trashed public folder sends it to the top level.
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
     * was trashed later then lands back in it. Folders higher up go first, because restoring a folder
     * also restores a trashed one above it. An unknown id rolls the whole restore back.
     */
    async restore(userId: string, selection: TrashSelection): Promise<TrashResult> {
        const folderIds = selection.folderIds ?? [];

        return db.transaction().execute(async (trx) => {
            const tree = await loadFolderTree(userId, trx);
            const topDown = [...folderIds].sort((a, b) => tree.ancestors(a).length - tree.ancestors(b).length);

            for (const id of topDown) await restoreFolder(userId, id, trx);

            const documents = await this.restoreDocumentsIn(trx, userId, selection.documentIds ?? []);

            return { documents, folders: folderIds.length };
        });
    }

    async listTrash(userId: string): Promise<TrashListing> {
        const [documents, tree, retentionDays] = await Promise.all([
            db.selectFrom('documents').selectAll().where('user_id', '=', userId).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
            loadFolderTree(userId),
            getSetting('trash.retentionDays'),
        ]);
        const roots = tree
            .all()
            .filter((folder) => isUnitRoot(tree, folder))
            .sort((a, b) => b.deleted_at!.getTime() - a.deleted_at!.getTime());
        // A document that went to the trash with its folder (same timestamp) is part of that folder's entry.
        const standalone = documents.filter(
            (doc) => doc.folder_id === null || tree.folder(doc.folder_id)?.deleted_at?.getTime() !== doc.deleted_at?.getTime(),
        );

        return {
            documents: standalone,
            folders: roots.map((root) => ({ ...root, ...toUnitCounts(tree, root, documents) })),
            retentionDays,
        };
    }

    /**
     * Delete trashed items for good ("Delete forever"). Live items are never touched, and a folder
     * with a closed lock at or beneath it (`lockedFolderIds`) is left alone, since deleting it would delete the lock too.
     */
    async purge(userId: string, selection: TrashSelection, lockedFolderIds: string[] = []): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId, ids: selection.documentIds ?? [] });
        const folders = await this.purgeFolderUnits({ userId, ids: selection.folderIds ?? [], lockedFolderIds });

        return { documents, folders };
    }

    /**
     * Empty the trash. Items under a closed lock (`lockedFolderIds`) are left alone: the user cannot
     * see them, so they must not be destroyed on their behalf.
     */
    async emptyTrash(userId: string, lockedFolderIds: string[] = []): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId, exceptFolderIds: lockedFolderIds });
        const folders = await this.purgeFolderUnits({ userId, lockedFolderIds });

        return { documents, folders };
    }

    /** The retention job: purge everything trashed longer ago than `trash.retentionDays`. */
    async purgeExpired(now: Date = new Date()): Promise<TrashResult> {
        const olderThan = new Date(now.getTime() - (await getSetting('trash.retentionDays')) * DAY_MS);
        const documents = await this.purgeDocuments({ olderThan });
        const folders = await this.purgeFolderUnits({ olderThan });

        return { documents, folders };
    }

    private async purgeDocuments(scope: DocumentPurgeScope): Promise<number> {
        if (scope.ids && scope.ids.length === 0) return 0;

        const purged = await db.transaction().execute((trx) => deleteTrashedDocuments(trx, scope));

        await this.deleteFiles(purged);

        return purged.length;
    }

    private async purgeFolderUnits(scope: FolderPurgeScope): Promise<number> {
        const { folders, documents } = await purgeFolders(scope);

        await this.deleteFiles(documents);

        return folders;
    }

    /** Files go after their rows, and only through deleteDocumentFiles (shared files survive). */
    private async deleteFiles(documents: Document[]): Promise<void> {
        const uploadService = getUploadService();

        for (const doc of documents) {
            try {
                await uploadService.deleteDocumentFiles(doc, doc.user_id);
            } catch (err) {
                console.error('Failed to delete file from storage:', err);
            }
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
