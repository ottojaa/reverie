import type { Folder } from '@reverie/shared';
import type { Folder as DbFolder } from '../db/schema.js';
import type { FolderLocks } from './folder-locks.js';
import { toFolderType } from './folders/paths.js';

export function serializeFolder(folder: DbFolder, locks: FolderLocks): Folder {
    return {
        id: folder.id,
        parent_id: folder.parent_id,
        name: folder.name,
        path: folder.path,
        description: folder.description,
        emoji: folder.emoji,
        sort_order: folder.sort_order,
        type: toFolderType(folder.parent_id),
        is_private: folder.is_private,
        locked: locks.isLocked(folder.id),
        lock_id: locks.lockIdOf(folder.id),
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
    };
}
