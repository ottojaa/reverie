import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Document, Folder } from '../db/schema';
import { getSetting } from '../settings/settings.service.js';
import { getDeduplicatedFilename } from '../utils/filename';
import { excludeTrashed } from './privacy';
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
        const folder = doc.folder_id
            ? await excludeTrashed(trx.selectFrom('folders').select('id').where('id', '=', doc.folder_id), '').executeTakeFirst()
            : undefined;
        const folderId = folder?.id ?? null;
        const taken = folderId
            ? await excludeTrashed(trx.selectFrom('documents').select('original_filename').where('folder_id', '=', folderId), '').execute()
            : [];
        const filename = getDeduplicatedFilename(
            taken.map((row) => row.original_filename),
            doc.original_filename,
        );

        await trx.updateTable('documents').set({ deleted_at: null, folder_id: folderId, original_filename: filename }).where('id', '=', doc.id).execute();
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

        return { documents, folders: topLevel, retentionDays };
    }

    /** Delete trashed items for good ("Delete forever"). Live items are never touched. */
    async purge(userId: string, selection: TrashSelection): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId, ids: selection.documentIds ?? [] });
        const folders = await this.purgeFolders({ userId, ids: selection.folderIds ?? [] });

        return { documents, folders };
    }

    async emptyTrash(userId: string): Promise<TrashResult> {
        const documents = await this.purgeDocuments({ userId });
        const folders = await this.purgeFolders({ userId });

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

    private async purgeFolders(scope: PurgeScope): Promise<number> {
        if (scope.ids && scope.ids.length === 0) return 0;

        const rows = await db
            .deleteFrom('folders')
            .where('deleted_at', 'is not', null)
            .$if(scope.userId !== undefined, (qb) => qb.where('user_id', '=', scope.userId!))
            .$if(scope.ids !== undefined, (qb) => qb.where('id', 'in', scope.ids!))
            .$if(scope.olderThan !== undefined, (qb) => qb.where('deleted_at', '<', scope.olderThan!))
            .returning('id')
            .execute();

        return rows.length;
    }
}

let trashServiceInstance: TrashService | null = null;

export function getTrashService(): TrashService {
    if (!trashServiceInstance) {
        trashServiceInstance = new TrashService();
    }

    return trashServiceInstance;
}
