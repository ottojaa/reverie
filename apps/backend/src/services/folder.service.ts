import { ConflictError, NotFoundError } from '@reverie/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { db } from '../db/kysely';
import type { Folder, FolderType, FolderUpdate, NewFolder } from '../db/schema';

type DbOrTrx = Kysely<Database>;

export class FolderService {
    /**
     * Create a new folder (scoped to user).
     * Pass trx for transactional use (e.g. from organize execute).
     */
    async createFolder(
        userId: string,
        name: string,
        parentId?: string,
        description?: string,
        emoji?: string | null,
        type?: FolderType,
        trx?: DbOrTrx,
    ): Promise<Folder> {
        const dbToUse = trx ?? db;
        const folderType: FolderType = type ?? 'folder';

        // Enforce two-level hierarchy
        if (folderType === 'collection' && parentId) {
            throw new ConflictError('Collections must be root-level (no parent)');
        }

        if (folderType === 'folder' && !parentId) {
            throw new ConflictError('Folders must have a parent collection');
        }

        if (folderType === 'folder' && parentId) {
            const parent = await this.getFolder(parentId, userId, trx);

            if (!parent) throw new NotFoundError('Folder', parentId);

            if (parent.type !== 'collection') {
                throw new ConflictError('Folders can only be nested under collections');
            }
        }

        // Build path
        let path = `/${name}`;

        if (parentId) {
            const parent = await this.getFolder(parentId, userId, trx);

            if (!parent) {
                throw new NotFoundError('Folder', parentId);
            }

            path = `${parent.path}/${name}`;
        }

        // Check for existing folder with same path (for this user)
        const existing = await dbToUse.selectFrom('folders').select('id').where('path', '=', path).where('user_id', '=', userId).executeTakeFirst();

        if (existing) {
            throw new ConflictError(`Folder already exists at path: ${path}`);
        }

        // Next sort_order among siblings
        const maxOrder = await dbToUse
            .selectFrom('folders')
            .select(dbToUse.fn.max('sort_order').as('max_order'))
            .where('user_id', '=', userId)
            .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
            .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
            .executeTakeFirst();
        const sort_order = (Number(maxOrder?.max_order ?? -1) || -1) + 1;

        const newFolder: NewFolder = {
            user_id: userId,
            name,
            parent_id: parentId ?? null,
            path,
            description: description ?? null,
            emoji: emoji ?? null,
            sort_order,
            type: folderType,
        };

        return dbToUse.insertInto('folders').values(newFolder).returningAll().executeTakeFirstOrThrow();
    }

    /**
     * Get folder by ID (scoped to user).
     * Pass trx for transactional use.
     */
    async getFolder(id: string, userId: string, trx?: DbOrTrx): Promise<Folder | undefined> {
        const dbToUse = trx ?? db;

        return dbToUse.selectFrom('folders').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    }

    /**
     * Get folder by path (scoped to user).
     * Pass trx for transactional use.
     */
    async getFolderByPath(path: string, userId: string, trx?: DbOrTrx): Promise<Folder | undefined> {
        const dbToUse = trx ?? db;

        return dbToUse.selectFrom('folders').selectAll().where('path', '=', path).where('user_id', '=', userId).executeTakeFirst();
    }

    /**
     * Get folder by path, or create it if it doesn't exist.
     * For path /X creates category X; for /X/Y creates section Y under category X (creating X if needed).
     * Pass trx for transactional use.
     * Returns { folder, createdCount } so callers can count creations (includes recursive parent creations).
     */
    async getOrCreateFolderByPath(path: string, userId: string, trx?: DbOrTrx): Promise<{ folder: Folder; createdCount: number }> {
        const existing = await this.getFolderByPath(path, userId, trx);

        if (existing) return { folder: existing, createdCount: 0 };

        const segments = path.split('/').filter(Boolean);

        if (segments.length === 0) {
            throw new ConflictError('Invalid path');
        }

        const name = segments[segments.length - 1]!;
        const isCategory = segments.length === 1;
        let parentId: string | null = null;
        let parentCreatedCount = 0;

        if (!isCategory) {
            const parentPath = '/' + segments.slice(0, -1).join('/');
            const parentResult = await this.getOrCreateFolderByPath(parentPath, userId, trx);
            parentId = parentResult.folder.id;
            parentCreatedCount = parentResult.createdCount;
        }

        const folder = await this.createFolder(userId, name, parentId ?? undefined, undefined, null, isCategory ? 'collection' : 'folder', trx);

        return { folder, createdCount: parentCreatedCount + 1 };
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
    async getSectionTree(
        userId: string,
    ): Promise<Array<Folder & { children: Array<Folder & { children: unknown[]; document_count: number }>; document_count: number }>> {
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
                await trx.updateTable('folders').set({ sort_order }).where('id', '=', id).where('user_id', '=', userId).execute();
            }
        });
    }

    /**
     * Get or create the default section for a user.
     * Returns a section (not a category) where documents can be stored.
     */
    async getOrCreateDefaultSection(userId: string): Promise<Folder> {
        // Find an existing section
        const existingSection = await db
            .selectFrom('folders')
            .selectAll()
            .where('user_id', '=', userId)
            .where('type', '=', 'folder')
            .orderBy('sort_order', 'asc')
            .executeTakeFirst();

        if (existingSection) return existingSection;

        // No sections exist; create a default category + section
        const categories = await this.listChildren(null, userId);
        let category: Folder;

        if (categories.length > 0) {
            category = categories[0]!;
        } else {
            category = await this.createFolder(userId, 'My Documents', undefined, undefined, '📁', 'collection');
        }

        return this.createFolder(userId, 'Documents', category.id, undefined, '📄', 'folder');
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

            // Enforce two-level model: collections stay root, folders stay under collections
            if (folder.type === 'collection' && newParentId !== null) {
                throw new ConflictError('Collections must remain at root level');
            }

            if (folder.type === 'folder') {
                if (newParentId === null) {
                    throw new ConflictError('Folders must have a parent collection');
                }

                const newParent = await this.getFolder(newParentId, userId);

                if (!newParent) throw new NotFoundError('Folder', newParentId);

                if (newParent.type !== 'collection') {
                    throw new ConflictError('Folders can only be moved to collections');
                }
            }

            if (newParentId) {
                const newParent = await this.getFolder(newParentId, userId);

                if (!newParent) throw new NotFoundError('Folder', newParentId);

                if (newParent.path.startsWith(folder.path + '/')) {
                    throw new ConflictError('Cannot move folder inside its own descendant');
                }
            }

            const newPath = newParentId ? `${(await this.getFolder(newParentId, userId))!.path}/${folder.name}` : `/${folder.name}`;
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
            updateData.sort_order = (Number(maxOrder?.max_order ?? -1) || -1) + 1;
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
     * Delete a folder (scoped to user).
     * Pass trx for transactional use.
     */
    async deleteFolder(id: string, userId: string, trx?: DbOrTrx): Promise<void> {
        const dbToUse = trx ?? db;
        const folder = await this.getFolder(id, userId, trx);

        if (!folder) {
            throw new NotFoundError('Folder', id);
        }

        // Cascade delete handled by FK constraint
        await dbToUse.deleteFrom('folders').where('id', '=', id).where('user_id', '=', userId).execute();
    }

    /**
     * Delete a folder only if it is empty (no documents, no child folders).
     * Throws ConflictError if folder has content.
     * Pass trx for transactional use.
     */
    async deleteEmptyFolder(id: string, userId: string, trx?: DbOrTrx): Promise<void> {
        const dbToUse = trx ?? db;
        const folder = await this.getFolder(id, userId, trx);

        if (!folder) {
            throw new NotFoundError('Folder', id);
        }

        const docCount = await dbToUse
            .selectFrom('documents')
            .select(dbToUse.fn.countAll().as('count'))
            .where('folder_id', '=', id)
            .where('user_id', '=', userId)
            .executeTakeFirst();

        if (Number(docCount?.count ?? 0) > 0) {
            throw new ConflictError('Cannot delete folder: it contains documents');
        }

        const childCount = await dbToUse
            .selectFrom('folders')
            .select(dbToUse.fn.countAll().as('count'))
            .where('parent_id', '=', id)
            .where('user_id', '=', userId)
            .executeTakeFirst();

        if (Number(childCount?.count ?? 0) > 0) {
            throw new ConflictError('Cannot delete folder: it contains subfolders');
        }

        await this.deleteFolder(id, userId, trx);
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
