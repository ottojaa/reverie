import type { FolderWithChildren } from '@reverie/shared';

export type DropZone = 'above' | 'center' | 'below';

export interface FlattenedSection {
    id: string;
    name: string;
    emoji: string | null;
    document_count: number;
    parentId: string | null;
    depth: number;
    index: number;
    children: FolderWithChildren[];
}

export interface ProjectionResult {
    depth: number;
    parentId: string | null;
    dropZone: DropZone;
    targetId: string;
}

/**
 * Flatten a tree into a list with depth information
 */
export function flattenTree(items: FolderWithChildren[], parentId: string | null = null, depth = 0): FlattenedSection[] {
    return items.reduce<FlattenedSection[]>((acc, item, index) => {
        return [
            ...acc,
            {
                id: item.id,
                name: item.name,
                emoji: item.emoji,
                document_count: item.document_count,
                parentId,
                depth,
                index,
                children: item.children,
            },
            ...flattenTree(item.children, item.id, depth + 1),
        ];
    }, []);
}

/**
 * Build a tree from flattened items
 */
export function buildTree(flattenedItems: FlattenedSection[]): FolderWithChildren[] {
    const root: { id: string; children: FolderWithChildren[] } = { id: 'root', children: [] };
    const nodes: Record<string, { id: string; children: FolderWithChildren[] }> = { [root.id]: root };
    const items = flattenedItems.map((item) => ({
        ...item,
        children: [] as FolderWithChildren[],
    }));

    for (const item of items) {
        const { id, children, name, emoji, document_count, parentId } = item;
        const parent = nodes[parentId ?? 'root'] ?? findItem(items, parentId);

        const treeItem: FolderWithChildren = {
            id,
            path: '',
            description: '',
            name,
            emoji,
            document_count,
            parent_id: parentId,
            children,
            sort_order: item.index,
            created_at: '',
            updated_at: '',
        };

        nodes[id] = treeItem;
        if (parent) {
            parent.children.push(treeItem);
        }
    }

    return root.children;
}

function findItem(items: FlattenedSection[], itemId: string | null) {
    if (!itemId) return null;
    return items.find(({ id }) => id === itemId);
}

/**
 * Determine drop zone based on pointer Y position relative to element
 * - Top 25% = above (sibling before)
 * - Middle 50% = center (become child)
 * - Bottom 25% = below (sibling after)
 */
export function getDropZone(pointerY: number, elementTop: number, elementHeight: number): DropZone {
    const relativeY = pointerY - elementTop;
    const percentage = relativeY / elementHeight;

    if (percentage < 0.15) return 'above';
    if (percentage > 0.85) return 'below';
    return 'center';
}

/**
 * Calculate where the dragged item will end up based on drop zone
 */
export function getProjection(items: FlattenedSection[], activeId: string, overId: string, dropZone: DropZone): ProjectionResult | null {
    const overItemIndex = items.findIndex(({ id }) => id === overId);
    const activeItemIndex = items.findIndex(({ id }) => id === activeId);

    if (overItemIndex === -1 || activeItemIndex === -1) return null;

    const overItem = items[overItemIndex]!;

    if (dropZone === 'center') {
        // Make it a child of the target
        return {
            depth: overItem.depth + 1,
            parentId: overItem.id,
            dropZone,
            targetId: overId,
        };
    }

    if (dropZone === 'above') {
        // Insert before target, same level as target
        return {
            depth: overItem.depth,
            parentId: overItem.parentId,
            dropZone,
            targetId: overId,
        };
    }

    // dropZone === 'below'
    // Insert after target, same level as target
    return {
        depth: overItem.depth,
        parentId: overItem.parentId,
        dropZone,
        targetId: overId,
    };
}

/**
 * Calculate the final position after drop
 */
export function calculateFinalPosition(
    items: FlattenedSection[],
    activeId: string,
    projection: ProjectionResult,
): { newParentId: string | null; insertIndex: number } {
    const { dropZone, targetId, parentId } = projection;
    const targetIndex = items.findIndex(({ id }) => id === targetId);
    const activeIndex = items.findIndex(({ id }) => id === activeId);

    if (targetIndex === -1 || activeIndex === -1) {
        return { newParentId: parentId, insertIndex: 0 };
    }

    // Get siblings at the destination level
    const siblings = items.filter((item) => item.parentId === parentId);

    if (dropZone === 'center') {
        // Becomes first child of target
        return { newParentId: targetId, insertIndex: 0 };
    }

    const targetSiblingIndex = siblings.findIndex(({ id }) => id === targetId);

    if (dropZone === 'above') {
        return { newParentId: parentId, insertIndex: targetSiblingIndex };
    }

    // below
    return { newParentId: parentId, insertIndex: targetSiblingIndex + 1 };
}

/**
 * Remove children of specified items (used when item is being dragged)
 */
export function removeChildrenOf(items: FlattenedSection[], ids: string[]): FlattenedSection[] {
    const excludeParentIds = [...ids];

    return items.filter((item) => {
        if (item.parentId && excludeParentIds.includes(item.parentId)) {
            if (item.children.length) {
                excludeParentIds.push(item.id);
            }
            return false;
        }

        return true;
    });
}

/**
 * Get child count for an item
 */
export function getChildCount(items: FolderWithChildren[], id: string): number {
    const item = findItemDeep(items, id);
    return item ? countChildren(item.children) : 0;
}

function findItemDeep(items: FolderWithChildren[], itemId: string): FolderWithChildren | undefined {
    for (const item of items) {
        if (item.id === itemId) {
            return item;
        }

        if (item.children.length) {
            const child = findItemDeep(item.children, itemId);
            if (child) return child;
        }
    }

    return undefined;
}

function countChildren(items: FolderWithChildren[], count = 0): number {
    return items.reduce((acc, { children }) => {
        if (children.length) {
            return countChildren(children, acc + 1);
        }
        return acc + 1;
    }, count);
}
