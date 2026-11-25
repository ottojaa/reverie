import type { FolderWithChildren } from '@reverie/shared';
import { findFolder } from './tree.js';

/** Where a dragged folder is let go: next to a folder, into a folder, or on the "top level" strip. */
export type FolderDrop = { zone: 'before' | 'into' | 'after'; targetId: string } | { zone: 'top' };

export interface FolderMove {
    /** The new parent (null: the top level). Left out when the folder stays where it is. */
    parentId?: string | null;
    /** New positions of every folder at that level. Left out for a move into a folder, which lands at the end. */
    order?: Array<{ id: string; sort_order: number }>;
}

function toReparent(folder: FolderWithChildren, parentId: string | null): FolderMove | null {
    return folder.parent_id === parentId ? null : { parentId };
}

function toPlacement(tree: FolderWithChildren[], folder: FolderWithChildren, target: FolderWithChildren, isAfter: boolean): FolderMove | null {
    const parentId = target.parent_id;
    const level = parentId === null ? tree : (findFolder(tree, parentId)?.children ?? []);
    const others = level.filter((sibling) => sibling.id !== folder.id);
    const index = others.findIndex((sibling) => sibling.id === target.id) + (isAfter ? 1 : 0);
    const ordered = [...others.slice(0, index), folder, ...others.slice(index)];
    const isSameLevel = folder.parent_id === parentId;

    if (isSameLevel && ordered.every((sibling, position) => sibling.id === level[position]?.id)) return null;

    const order = ordered.map((sibling, position) => ({ id: sibling.id, sort_order: position }));

    return isSameLevel ? { order } : { parentId, order };
}

/** What dropping a folder there changes, or null when nothing would (or the target is inside the folder). */
export function planMove(tree: FolderWithChildren[], folderId: string, drop: FolderDrop): FolderMove | null {
    const folder = findFolder(tree, folderId);

    if (!folder) return null;

    if (drop.zone === 'top') return toReparent(folder, null);

    const target = findFolder(tree, drop.targetId);

    if (!target || findFolder([folder], target.id)) return null;

    if (drop.zone === 'into') return toReparent(folder, target.id);

    return toPlacement(tree, folder, target, drop.zone === 'after');
}
