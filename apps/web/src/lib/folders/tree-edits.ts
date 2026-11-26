import type { FolderWithChildren, UpdateFolderRequest } from '@reverie/shared';
import { produce } from 'immer';
import { findFolder } from './tree.js';

// Optimistic edits of the cached folder tree. Counts and locks are left for the next fetch to settle.

/** Orders every group of siblings named in `updates` by the new positions. */
export function reorderTree(tree: FolderWithChildren[], updates: Array<{ id: string; sort_order: number }>): FolderWithChildren[] {
    const positions = new Map(updates.map((update) => [update.id, update.sort_order]));

    return produce(tree, (draft) => {
        function sortLevel(folders: FolderWithChildren[]) {
            folders.forEach((folder) => sortLevel(folder.children));

            if (!folders.some((folder) => positions.has(folder.id))) return;

            folders.sort((a, b) => (positions.get(a.id) ?? a.sort_order) - (positions.get(b.id) ?? b.sort_order));
        }

        sortLevel(draft);
    });
}

/** Changes a folder's own fields; `parent_id` is a move and is handled by moveInTree. */
export function patchInTree(tree: FolderWithChildren[], id: string, patch: Omit<UpdateFolderRequest, 'parent_id'>): FolderWithChildren[] {
    return produce(tree, (draft) => {
        const folder = findFolder(draft, id);

        if (folder) Object.assign(folder, patch);
    });
}

/** Moves a folder to the end of another folder's subfolders, or of the top level (null). */
export function moveInTree(tree: FolderWithChildren[], id: string, parentId: string | null): FolderWithChildren[] {
    return produce(tree, (draft) => {
        const folder = findFolder(draft, id);

        if (!folder) return;

        const from = findFolder(draft, folder.parent_id)?.children ?? draft;
        const to = parentId === null ? draft : findFolder(draft, parentId)?.children;

        if (!to) return;

        from.splice(from.indexOf(folder), 1);
        folder.parent_id = parentId;
        to.push(folder);
    });
}
