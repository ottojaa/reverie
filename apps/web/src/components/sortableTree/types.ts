import type { UniqueIdentifier } from '@dnd-kit/core';
import type { RefObject } from 'react';

export interface TreeItem {
    id: UniqueIdentifier;
    children: TreeItem[];
    collapsed?: boolean;
}

export type TreeItems = TreeItem[];

export interface FlattenedItem extends TreeItem {
    parentId: UniqueIdentifier | null;
    depth: number;
    index: number;
}

export type SensorContext = RefObject<{
    items: FlattenedItem[];
    offset: number;
}>;
