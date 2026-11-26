import type { FolderWithChildren } from '@reverie/shared';

export interface FolderRow {
    folder: FolderWithChildren;
    /** 0 for a top-level folder. */
    depth: number;
}

/** Deeper folders stop indenting further: past this a sidebar row has too little room left for its name. */
const MAX_INDENTED_DEPTH = 4;

/** Left padding in pixels of a row for a folder this deep. */
export function toIndent(depth: number): number {
    return 8 + Math.min(depth, MAX_INDENTED_DEPTH) * 18;
}

/** The tree as a list, each folder before its subfolders. `isOpen` says whose subfolders are listed. */
export function flattenTree(tree: FolderWithChildren[], isOpen: (folder: FolderWithChildren) => boolean = () => true, depth = 0): FolderRow[] {
    return tree.flatMap((folder) => [{ folder, depth }, ...(isOpen(folder) ? flattenTree(folder.children, isOpen, depth + 1) : [])]);
}

/** Rows for a name search: each matching folder with everything in it, and the folders on the way to a match. */
export function searchTree(tree: FolderWithChildren[], query: string, depth = 0): FolderRow[] {
    const needle = query.trim().toLowerCase();

    return tree.flatMap((folder) => {
        if (folder.name.toLowerCase().includes(needle)) return [{ folder, depth }, ...flattenTree(folder.children, undefined, depth + 1)];

        const below = searchTree(folder.children, query, depth + 1);

        return below.length > 0 ? [{ folder, depth }, ...below] : [];
    });
}

/** The folder with every folder above it, top level first. Empty when the tree does not hold it. */
export function findFolderChain(tree: FolderWithChildren[], id: string): FolderWithChildren[] {
    for (const folder of tree) {
        if (folder.id === id) return [folder];

        const below = findFolderChain(folder.children, id);

        if (below.length > 0) return [folder, ...below];
    }

    return [];
}

export function findFolder(tree: FolderWithChildren[], id: string | null | undefined): FolderWithChildren | null {
    if (!id) return null;

    return findFolderChain(tree, id).at(-1) ?? null;
}

/** The folder with this path. Live folders never share one. */
export function findFolderByPath(tree: FolderWithChildren[], path: string): FolderWithChildren | null {
    return flattenTree(tree).find((row) => row.folder.path === path)?.folder ?? null;
}

/** Documents in the folder and beneath it, behind the same lock as the folder. Zero while it is locked. */
export function toTotalCount(folder: FolderWithChildren): number {
    const { image, video, file } = folder.kind_counts;

    return image + video + file;
}

/** The folder's own documents: its total minus what the subfolders behind the same lock added to it. */
export function toOwnCount(folder: FolderWithChildren): number {
    const sameLock = folder.children.filter((child) => child.lock_id === folder.lock_id);

    return sameLock.reduce((count, child) => count - toTotalCount(child), toTotalCount(folder));
}
