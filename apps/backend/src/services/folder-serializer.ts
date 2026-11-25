import type { Folder } from '@reverie/shared';
import type { Folder as DbFolder } from '../db/schema.js';
import type { FolderLocks } from './folder-locks.js';

export function serializeFolder(folder: DbFolder, locks: FolderLocks): Folder {
    return {
        id: folder.id,
        parent_id: folder.parent_id,
        name: folder.name,
        path: folder.path,
        description: folder.description,
        emoji: folder.emoji,
        sort_order: folder.sort_order,
        type: folder.type,
        is_private: folder.is_private,
        locked: locks.isLocked(folder.id),
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}

/**
 * Whether a folder gets a cover in a listing: not a collection, and nothing private. An open lock still gets
 * no cover, because private documents (ids, filenames) stay out of every listing, open or not: they are only
 * reachable by asking for their folder.
 */
export function hasCover(folder: Pick<DbFolder, 'id' | 'type'>, locks: FolderLocks): boolean {
    return folder.type === 'folder' && !locks.isPrivate(folder.id);
}
