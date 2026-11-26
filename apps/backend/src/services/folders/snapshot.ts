/**
 * One user's folders, as read at one moment. Folders nest to any depth, and every question about that
 * nesting (what is beneath a folder, which lock covers it) is answered here, over all rows including
 * trashed ones: a trashed private folder stays private.
 */

export interface FolderNode {
    id: string;
    parent_id: string | null;
    name: string;
    sort_order: number;
    is_private: boolean;
    deleted_at: Date | null;
}

export interface TreeScope {
    /** Also walk trashed folders. Without it only live folders reached through live folders are returned. */
    trashed?: boolean;
}

export interface FolderTree<F extends FolderNode> {
    /** Every folder, trashed ones included, in sibling order. */
    all(): readonly F[];
    folder(id: string): F | undefined;
    /** The folders directly inside `parentId` (null: the top level), in sibling order. */
    children(parentId: string | null, scope?: TreeScope): F[];
    /** The folders above `id`, from the top level down. */
    ancestors(id: string): F[];
    /** `id` and everything beneath it, each parent before its children. */
    subtree(id: string, scope?: TreeScope): F[];
    /** The outermost private folder among `id` and the folders above it; null when `id` is public. */
    lockOf(id: string): string | null;
}

function bySiblingOrder(a: FolderNode, b: FolderNode): number {
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function groupByParent<F extends FolderNode>(rows: readonly F[]): Map<string | null, F[]> {
    const groups = new Map<string | null, F[]>();

    for (const row of rows) {
        const siblings = groups.get(row.parent_id);

        if (siblings) siblings.push(row);
        else groups.set(row.parent_id, [row]);
    }

    return groups;
}

export function toFolderTree<F extends FolderNode>(rows: readonly F[]): FolderTree<F> {
    const sorted = [...rows].sort(bySiblingOrder);
    const byId = new Map(sorted.map((row) => [row.id, row]));
    const byParent = groupByParent(sorted);

    function children(parentId: string | null, scope: TreeScope = {}): F[] {
        const all = byParent.get(parentId) ?? [];

        return scope.trashed ? [...all] : all.filter((row) => row.deleted_at === null);
    }

    // Both walks remember what they have seen, so a parent loop in bad data ends instead of hanging.
    function ancestors(id: string): F[] {
        const seen = new Set([id]);
        const above: F[] = [];
        let parentId = byId.get(id)?.parent_id ?? null;

        while (parentId !== null && !seen.has(parentId)) {
            const parent = byId.get(parentId);

            if (!parent) break;

            seen.add(parent.id);
            above.unshift(parent);
            parentId = parent.parent_id;
        }

        return above;
    }

    function subtree(id: string, scope: TreeScope = {}): F[] {
        const root = byId.get(id);

        if (!root || (root.deleted_at !== null && !scope.trashed)) return [];

        const seen = new Set([root.id]);
        const found = [root];

        // The array grows while it is walked: each folder's children are appended behind it.
        for (const folder of found) {
            for (const child of children(folder.id, scope)) {
                if (seen.has(child.id)) continue;

                seen.add(child.id);
                found.push(child);
            }
        }

        return found;
    }

    function lockOf(id: string): string | null {
        const own = byId.get(id);

        if (!own) return null;

        return [...ancestors(id), own].find((folder) => folder.is_private)?.id ?? null;
    }

    return { all: () => sorted, folder: (id) => byId.get(id), children, ancestors, subtree, lockOf };
}
