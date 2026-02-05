import { ConflictError, NotFoundError } from '@reverie/shared';
import { db } from '../db/kysely';
import type { Folder, FolderUpdate, NewFolder } from '../db/schema';

export class FolderService {
    /**
     * Create a new folder (scoped to user)
     */
    async createFolder(
        userId: string,
        name: string,
        parentId?: string,
        description?: string,
        emoji?: string | null,
    ): Promise<Folder> {
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

        // Next sort_order among siblings
        const maxOrder = await db
            .selectFrom('folders')
            .select(db.fn.max('sort_order').as('max_order'))
            .where('user_id', '=', userId)
            .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
            .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
            .executeTakeFirst();
        const sort_order = (Number(maxOrder?.max_order ?? -1) ?? -1) + 1;

        const newFolder: NewFolder = {
            user_id: userId,
            name,
            parent_id: parentId ?? null,
            path,
            description: description ?? null,
            emoji: emoji ?? null,
            sort_order,
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
     * List children of a folder (scoped to user), ordered by sort_order
     */
    async listChildren(parentId: string | null, userId: string): Promise<Folder[]> {
        return db
            .selectFrom('folders')
            .selectAll()
            .where('user_id', '=', userId)
            .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
            .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
            .orderBy('sort_order', 'asc')
            .orderBy('name', 'asc')
            .execute();
    }

    /**
     * Get full section tree (root folders with nested children and document_count)
     */
    async getSectionTree(userId: string): Promise<Array<Folder & { children: Array<Folder & { children: unknown[]; document_count: number }>; document_count: number }>> {
        const buildTree = async (parentId: string | null): Promise<Array<Folder & { children: unknown[]; document_count: number }>> => {
            const folders = await this.listChildren(parentId, userId);
            const result: Array<Folder & { children: unknown[]; document_count: number }> = [];
            for (const folder of folders) {
                const document_count = await this.getDocumentCount(folder.id, userId);
                const children = await buildTree(folder.id);
                result.push({ ...folder, children, document_count });
            }
            return result;
        };
        return buildTree(null) as Promise<
            Array<Folder & { children: Array<Folder & { children: unknown[]; document_count: number }>; document_count: number }>
        >;
    }

    private async getDocumentCount(folderId: string, userId: string): Promise<number> {
        const r = await db
            .selectFrom('documents')
            .select(db.fn.countAll().as('count'))
            .where('folder_id', '=', folderId)
            .where('user_id', '=', userId)
            .executeTakeFirst();
        return Number(r?.count ?? 0);
    }

    /**
     * Get folder with document count (scoped to user)
     */
    async getFolderWithCount(id: string, userId: string): Promise<(Folder & { document_count: number }) | undefined> {
        const folder = await this.getFolder(id, userId);
        if (!folder) return undefined;
        const document_count = await this.getDocumentCount(id, userId);
        return { ...folder, document_count };
    }

    /**
     * Reorder sections (batch update sort_order)
     */
    async reorderSections(userId: string, updates: Array<{ id: string; sort_order: number }>): Promise<void> {
        if (updates.length === 0) return;
        await db.transaction().execute(async (trx) => {
            for (const { id, sort_order } of updates) {
                await trx
                    .updateTable('folders')
                    .set({ sort_order })
                    .where('id', '=', id)
                    .where('user_id', '=', userId)
                    .execute();
            }
        });
    }

    /**
     * Get or create the default section for a user (e.g. "My Documents")
     */
    async getOrCreateDefaultSection(userId: string): Promise<Folder> {
        const rootFolders = await this.listChildren(null, userId);
        if (rootFolders.length > 0) {
            return rootFolders[0]!;
        }
        return this.createFolder(userId, 'My Documents', undefined, undefined, '📁');
    }

    /**
     * Update a folder (scoped to user)
     */
    async updateFolder(
        id: string,
        userId: string,
        update: {
            name?: string | undefined;
            description?: string | null | undefined;
            emoji?: string | null | undefined;
            parent_id?: string | null | undefined;
        },
    ): Promise<Folder> {
        const folder = await this.getFolder(id, userId);
        if (!folder) {
            throw new NotFoundError('Folder', id);
        }

        const updateData: FolderUpdate = {};

        if (update.parent_id !== undefined) {
            const newParentId = update.parent_id ?? null;
            if (newParentId === id) {
                throw new ConflictError('Folder cannot be its own parent');
            }
            if (newParentId) {
                const newParent = await this.getFolder(newParentId, userId);
                if (!newParent) throw new NotFoundError('Folder', newParentId);
                if (newParent.path.startsWith(folder.path + '/')) {
                    throw new ConflictError('Cannot move folder inside its own descendant');
                }
            }
            const newPath = newParentId
                ? `${(await this.getFolder(newParentId, userId))!.path}/${folder.name}`
                : `/${folder.name}`;
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
            const maxOrder = await db
                .selectFrom('folders')
                .select(db.fn.max('sort_order').as('max_order'))
                .where('user_id', '=', userId)
                .$if(newParentId === null, (qb) => qb.where('parent_id', 'is', null))
                .$if(newParentId !== null, (qb) => qb.where('parent_id', '=', newParentId!))
                .executeTakeFirst();
            updateData.parent_id = newParentId;
            updateData.path = newPath;
            updateData.sort_order = (Number(maxOrder?.max_order ?? -1) ?? -1) + 1;
        }

        if (update.name !== undefined && update.name !== folder.name) {
            const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'));
            const newPath = parentPath ? `${parentPath}/${update.name}` : `/${update.name}`;
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
        }

        if (update.description !== undefined) {
            updateData.description = update.description;
        }

        if (update.emoji !== undefined) {
            updateData.emoji = update.emoji;
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
