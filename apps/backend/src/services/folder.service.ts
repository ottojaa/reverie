import { ConflictError, NotFoundError } from '@reverie/shared';
import { db } from '../db/kysely';
import type { Folder, FolderUpdate, NewFolder } from '../db/schema';

export class FolderService {
    /**
     * Create a new folder (scoped to user)
     */
    async createFolder(userId: string, name: string, parentId?: string, description?: string): Promise<Folder> {
        // Build path
        let path = `/${name}`;
        if (parentId) {
            const parent = await this.getFolder(parentId, userId);
            if (!parent) {
                throw new NotFoundError('Folder', parentId);
            }
            path = `${parent.path}/${name}`;
        }

        // Check for existing folder with same path (for this user)
        const existing = await db.selectFrom('folders').select('id').where('path', '=', path).where('user_id', '=', userId).executeTakeFirst();

        if (existing) {
            throw new ConflictError(`Folder already exists at path: ${path}`);
        }

        const newFolder: NewFolder = {
            user_id: userId,
            name,
            parent_id: parentId ?? null,
            path,
            description: description ?? null,
        };

        return db.insertInto('folders').values(newFolder).returningAll().executeTakeFirstOrThrow();
    }

    /**
     * Get folder by ID (scoped to user)
     */
    async getFolder(id: string, userId: string): Promise<Folder | undefined> {
        return db.selectFrom('folders').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    }

    /**
     * Get folder by path (scoped to user)
     */
    async getFolderByPath(path: string, userId: string): Promise<Folder | undefined> {
        return db.selectFrom('folders').selectAll().where('path', '=', path).where('user_id', '=', userId).executeTakeFirst();
    }

    /**
     * List children of a folder (scoped to user)
     */
    async listChildren(parentId: string | null, userId: string): Promise<Folder[]> {
        return db
            .selectFrom('folders')
            .selectAll()
            .where('user_id', '=', userId)
            .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
            .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
            .orderBy('name', 'asc')
            .execute();
    }

    /**
     * Get folder with document count (scoped to user)
     */
    async getFolderWithCount(id: string, userId: string): Promise<(Folder & { document_count: number }) | undefined> {
        const folder = await this.getFolder(id, userId);
        if (!folder) {
            return undefined;
        }

        const countResult = await db
            .selectFrom('documents')
            .select(db.fn.countAll().as('count'))
            .where('folder_id', '=', id)
            .where('user_id', '=', userId)
            .executeTakeFirst();

        return {
            ...folder,
            document_count: Number(countResult?.count ?? 0),
        };
    }

    /**
     * Update a folder (scoped to user)
     */
    async updateFolder(id: string, userId: string, update: { name?: string | undefined; description?: string | null | undefined }): Promise<Folder> {
        const folder = await this.getFolder(id, userId);
        if (!folder) {
            throw new NotFoundError('Folder', id);
        }

        const updateData: FolderUpdate = {};

        if (update.name !== undefined && update.name !== folder.name) {
            // Rebuild path
            const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'));
            const newPath = parentPath ? `${parentPath}/${update.name}` : `/${update.name}`;

            // Check for conflicts (for this user)
            const existing = await db
                .selectFrom('folders')
                .select('id')
                .where('path', '=', newPath)
                .where('user_id', '=', userId)
                .where('id', '!=', id)
                .executeTakeFirst();

            if (existing) {
                throw new ConflictError(`Folder already exists at path: ${newPath}`);
            }

            updateData.name = update.name;
            updateData.path = newPath;

            // TODO: Update child folder paths recursively
        }

        if (update.description !== undefined) {
            updateData.description = update.description;
        }

        if (Object.keys(updateData).length === 0) {
            return folder;
        }

        return db.updateTable('folders').set(updateData).where('id', '=', id).where('user_id', '=', userId).returningAll().executeTakeFirstOrThrow();
    }

    /**
     * Delete a folder (scoped to user)
     */
    async deleteFolder(id: string, userId: string): Promise<void> {
        const folder = await this.getFolder(id, userId);
        if (!folder) {
            throw new NotFoundError('Folder', id);
        }

        // Cascade delete handled by FK constraint
        await db.deleteFrom('folders').where('id', '=', id).where('user_id', '=', userId).execute();
    }
}

// Singleton
let folderServiceInstance: FolderService | null = null;

export function getFolderService(): FolderService {
    if (!folderServiceInstance) {
        folderServiceInstance = new FolderService();
    }
    return folderServiceInstance;
}
