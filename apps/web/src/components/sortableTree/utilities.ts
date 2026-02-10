import type { UniqueIdentifier } from '@dnd-kit/core';

import type { DropZone, FlattenedItem, TreeItem, TreeItems } from './types';

export const iOS = /iPad|iPhone|iPod/.test(navigator.platform);

/**
 * Determine drop zone based on pointer Y position relative to element.
 * Top 15% = above, middle 70% = center, bottom 15% = below.
 */
export function getDropZone(pointerY: number, elementTop: number, elementHeight: number): DropZone {
    const relativeY = pointerY - elementTop;
    const percentage = relativeY / elementHeight;
    if (percentage < 0.15) return 'above';
    if (percentage > 0.85) return 'below';
    return 'center';
}

export type IndicatorType = 'line' | 'background-highlight';
export type IndicatorLineEdge = 'top' | 'bottom';

export interface ProjectionResult {
    depth: number;
    parentId: UniqueIdentifier | null;
    indicatorHostId: UniqueIdentifier;
    indicatorType: IndicatorType;
    indicatorLineEdge: IndicatorLineEdge;
}

/**
 * Calculate where the dragged item will end up based on drop zone.
 * Center or below-when-next-is-child: become first child of over item.
 * Above or below-sibling: become sibling.
 * Also returns canonical indicator host/type so the same logical drop always shows the same indicator.
 */
export function getProjection(items: FlattenedItem[], activeId: UniqueIdentifier, overId: UniqueIdentifier, dropZone: DropZone): ProjectionResult | null {
    const overItemIndex = items.findIndex(({ id }) => id === overId);
    if (overItemIndex === -1) return null;

    const overItem = items[overItemIndex]!;
    const nextItem = items[overItemIndex + 1];

    if (dropZone === 'center') {
        return {
            depth: overItem.depth + 1,
            parentId: overItem.id,
            indicatorHostId: overId,
            indicatorType: 'background-highlight',
            indicatorLineEdge: 'top',
        };
    }

    if (dropZone === 'above') {
        return {
            depth: overItem.depth,
            parentId: overItem.parentId,
            indicatorHostId: overId,
            indicatorType: 'line',
            indicatorLineEdge: 'top',
        };
    }

    // dropZone === 'below'
    const nextIsChildOfOver = nextItem != null && nextItem.parentId === overId;
    if (nextIsChildOfOver) {
        return {
            depth: overItem.depth + 1,
            parentId: overItem.id,
            indicatorHostId: nextItem!.id,
            indicatorType: 'line',
            indicatorLineEdge: 'top',
        };
    }

    // Below over, not as child: sibling below. Line on top of next = same as line below over. If no next, line at bottom of over.
    const lineHostId = nextItem != null ? nextItem.id : overId;
    const lineEdge: IndicatorLineEdge = nextItem != null ? 'top' : 'bottom';

    return {
        depth: overItem.depth,
        parentId: overItem.parentId,
        indicatorHostId: lineHostId,
        indicatorType: 'line',
        indicatorLineEdge: lineEdge,
    };
}

/**
 * Collect id and all descendant ids for an item in the tree (for highlight set).
 */
export function getDescendantIds(items: TreeItems, itemId: UniqueIdentifier): Set<UniqueIdentifier> {
    const set = new Set<UniqueIdentifier>();
    const item = findItemDeep(items, itemId);
    if (!item) return set;

    set.add(itemId);
    function walk(nodes: TreeItem[]) {
        for (const node of nodes) {
            set.add(node.id);
            walk(node.children);
        }
    }
    walk(item.children);
    return set;
}

function flatten(items: TreeItems, parentId: UniqueIdentifier | null = null, depth = 0): FlattenedItem[] {
    return items.reduce<FlattenedItem[]>((acc, item, index) => {
        return [...acc, { ...item, parentId, depth, index }, ...flatten(item.children, item.id, depth + 1)];
    }, []);
}

export function flattenTree(items: TreeItems): FlattenedItem[] {
    return flatten(items);
}

/** Set of all node ids in the tree (for structure comparison). */
export function getTreeIds(items: TreeItems): Set<UniqueIdentifier> {
    const ids = new Set<UniqueIdentifier>();
    function walk(nodes: TreeItems) {
        for (const node of nodes) {
            ids.add(node.id);
            walk(node.children);
        }
    }
    walk(items);
    return ids;
}

export function buildTree(flattenedItems: FlattenedItem[]): TreeItems {
    const root: TreeItem = { id: 'root', children: [] };
    const nodes: Record<string, TreeItem> = { [root.id]: root };
    const items = flattenedItems.map((item) => ({ ...item, children: [] }));

    for (const item of items) {
        const { id, children } = item;
        const parentId = item.parentId ?? root.id;
        const parent = nodes[parentId] ?? findItem(items, parentId);

        if (!parent) continue;

        nodes[id] = { id, children };
        parent.children.push(item);
    }

    return root.children;
}

export function findItem(items: TreeItem[], itemId: UniqueIdentifier) {
    return items.find(({ id }) => id === itemId);
}

export function findItemDeep(items: TreeItems, itemId: UniqueIdentifier): TreeItem | undefined {
    for (const item of items) {
        const { id, children } = item;

        if (id === itemId) {
            return item;
        }

        if (children.length) {
            const child = findItemDeep(children, itemId);

            if (child) {
                return child;
            }
        }
    }

    return undefined;
}

export function removeItem(items: TreeItems, id: UniqueIdentifier) {
    const newItems = [];

    for (const item of items) {
        if (item.id === id) {
            continue;
        }

        if (item.children.length) {
            item.children = removeItem(item.children, id);
        }

        newItems.push(item);
    }

    return newItems;
}

/**
 * Remove item from tree and return the removed item (with children), or undefined if not found.
 */
export function extractItem(items: TreeItems, id: UniqueIdentifier): { tree: TreeItems; item: TreeItem | undefined } {
    let extracted: TreeItem | undefined;
    function remove(nodes: TreeItems): TreeItems {
        return nodes.flatMap((node) => {
            if (node.id === id) {
                extracted = JSON.parse(JSON.stringify(node)) as TreeItem;
                return [];
            }
            return [{ ...node, children: remove(node.children) }];
        });
    }
    const tree = remove(items);
    return { tree, item: extracted };
}

export interface InsertOptions {
    parentId: UniqueIdentifier | null;
    beforeId?: UniqueIdentifier;
    afterId?: UniqueIdentifier;
}

/**
 * Insert item as first child of parentId (root if null), or before/after a sibling.
 */
export function insertItem(items: TreeItems, item: TreeItem, options: InsertOptions): TreeItems {
    const { parentId, beforeId, afterId } = options;

    function insertInto(nodes: TreeItems, parent: UniqueIdentifier | null): TreeItems {
        if (parent !== parentId) {
            return nodes.map((node) => ({ ...node, children: insertInto(node.children, node.id) }));
        }

        if (beforeId != null) {
            const idx = nodes.findIndex((n) => n.id === beforeId);
            if (idx === -1) {
                return nodes.map((node) => ({ ...node, children: insertInto(node.children, node.id) }));
            }
            const next = [...nodes];
            next.splice(idx, 0, item);
            return next;
        }

        if (afterId != null) {
            const idx = nodes.findIndex((n) => n.id === afterId);
            if (idx === -1) {
                return nodes.map((node) => ({ ...node, children: insertInto(node.children, node.id) }));
            }
            const next = [...nodes];
            next.splice(idx + 1, 0, item);
            return next;
        }

        return [item, ...nodes];
    }

    return insertInto(items, null);
}

export function setProperty<T extends keyof TreeItem>(items: TreeItems, id: UniqueIdentifier, property: T, setter: (value: TreeItem[T]) => TreeItem[T]) {
    for (const item of items) {
        if (item.id === id) {
            item[property] = setter(item[property]);
            continue;
        }

        if (item.children.length) {
            item.children = setProperty(item.children, id, property, setter);
        }
    }

    return [...items];
}

function countChildren(items: TreeItem[], count = 0): number {
    return items.reduce((acc, { children }) => {
        if (children.length) {
            return countChildren(children, acc + 1);
        }

        return acc + 1;
    }, count);
}

export function getChildCount(items: TreeItems, id: UniqueIdentifier) {
    const item = findItemDeep(items, id);

    return item ? countChildren(item.children) : 0;
}

/**
 * Max depth of the subtree below this item (0 = leaf, 1 = has children, 2 = has grandchildren, etc).
 * Uses flattened list so it works regardless of id type; in depth-first order all descendants follow the item.
 */
export function getMaxDepthBelowFromFlattened(flattened: FlattenedItem[], id: UniqueIdentifier): number {
    const idx = flattened.findIndex((item) => String(item.id) === String(id));
    if (idx === -1) return 0;
    const activeDepth = flattened[idx]!.depth;
    let maxDescendantDepth = -1;
    for (let i = idx + 1; i < flattened.length; i++) {
        const d = flattened[i]!.depth;
        if (d <= activeDepth) break;
        if (d > maxDescendantDepth) maxDescendantDepth = d;
    }
    return maxDescendantDepth < 0 ? 0 : maxDescendantDepth - activeDepth;
}

export function removeChildrenOf(items: FlattenedItem[], ids: UniqueIdentifier[]) {
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
 * From a tree, compute sort_order for every node (index among siblings).
 * Used to persist section order via useReorderSections.
 */
export function treeItemsToOrderUpdates(treeItems: TreeItems): Array<{ id: string; sort_order: number }> {
    const updates: Array<{ id: string; sort_order: number }> = [];
    function walk(nodes: TreeItem[]) {
        nodes.forEach((node, index) => {
            updates.push({ id: String(node.id), sort_order: index });
            walk(node.children);
        });
    }
    walk(treeItems);
    return updates;
}

/**
 * From a tree, compute parentId for every node (null for root).
 * Used to detect parent_id changes for useUpdateFolder.
 */
export function treeItemsToParentMap(treeItems: TreeItems): Map<string, string | null> {
    const map = new Map<string, string | null>();
    function walk(nodes: TreeItem[], parentId: string | null) {
        nodes.forEach((node) => {
            map.set(String(node.id), parentId);
            walk(node.children, String(node.id));
        });
    }
    walk(treeItems, null);
    return map;
}
