import { db } from '../db/kysely'
import type { Folder, NewFolder, FolderUpdate } from '../db/schema'
import { NotFoundError, ConflictError } from '@reverie/shared'

export class FolderService {
  /**
   * Create a new folder
   */
  async createFolder(name: string, parentId?: string, description?: string): Promise<Folder> {
    // Build path
    let path = `/${name}`
    if (parentId) {
      const parent = await this.getFolder(parentId)
      if (!parent) {
        throw new NotFoundError('Folder', parentId)
      }
      path = `${parent.path}/${name}`
    }

    // Check for existing folder with same path
    const existing = await db
      .selectFrom('folders')
      .select('id')
      .where('path', '=', path)
      .executeTakeFirst()

    if (existing) {
      throw new ConflictError(`Folder already exists at path: ${path}`)
    }

    const newFolder: NewFolder = {
      name,
      parent_id: parentId ?? null,
      path,
      description: description ?? null,
    }

    return db
      .insertInto('folders')
      .values(newFolder)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /**
   * Get folder by ID
   */
  async getFolder(id: string): Promise<Folder | undefined> {
    return db
      .selectFrom('folders')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
  }

  /**
   * Get folder by path
   */
  async getFolderByPath(path: string): Promise<Folder | undefined> {
    return db
      .selectFrom('folders')
      .selectAll()
      .where('path', '=', path)
      .executeTakeFirst()
  }

  /**
   * List children of a folder
   */
  async listChildren(parentId: string | null): Promise<Folder[]> {
    return db
      .selectFrom('folders')
      .selectAll()
      .$if(parentId === null, (qb) => qb.where('parent_id', 'is', null))
      .$if(parentId !== null, (qb) => qb.where('parent_id', '=', parentId!))
      .orderBy('name', 'asc')
      .execute()
  }

  /**
   * Get folder with document count
   */
  async getFolderWithCount(id: string): Promise<(Folder & { document_count: number }) | undefined> {
    const folder = await this.getFolder(id)
    if (!folder) {
      return undefined
    }

    const countResult = await db
      .selectFrom('documents')
      .select(db.fn.countAll().as('count'))
      .where('folder_id', '=', id)
      .executeTakeFirst()

    return {
      ...folder,
      document_count: Number(countResult?.count ?? 0),
    }
  }

  /**
   * Update a folder
   */
  async updateFolder(id: string, update: { name?: string | undefined; description?: string | null | undefined }): Promise<Folder> {
    const folder = await this.getFolder(id)
    if (!folder) {
      throw new NotFoundError('Folder', id)
    }

    const updateData: FolderUpdate = {}

    if (update.name !== undefined && update.name !== folder.name) {
      // Rebuild path
      const parentPath = folder.path.substring(0, folder.path.lastIndexOf('/'))
      const newPath = parentPath ? `${parentPath}/${update.name}` : `/${update.name}`

      // Check for conflicts
      const existing = await db
        .selectFrom('folders')
        .select('id')
        .where('path', '=', newPath)
        .where('id', '!=', id)
        .executeTakeFirst()

      if (existing) {
        throw new ConflictError(`Folder already exists at path: ${newPath}`)
      }

      updateData.name = update.name
      updateData.path = newPath

      // TODO: Update child folder paths recursively
    }

    if (update.description !== undefined) {
      updateData.description = update.description
    }

    if (Object.keys(updateData).length === 0) {
      return folder
    }

    return db
      .updateTable('folders')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /**
   * Delete a folder
   */
  async deleteFolder(id: string): Promise<void> {
    const folder = await this.getFolder(id)
    if (!folder) {
      throw new NotFoundError('Folder', id)
    }

    // Cascade delete handled by FK constraint
    await db
      .deleteFrom('folders')
      .where('id', '=', id)
      .execute()
  }
}

// Singleton
let folderServiceInstance: FolderService | null = null

export function getFolderService(): FolderService {
  if (!folderServiceInstance) {
    folderServiceInstance = new FolderService()
  }
  return folderServiceInstance
}

