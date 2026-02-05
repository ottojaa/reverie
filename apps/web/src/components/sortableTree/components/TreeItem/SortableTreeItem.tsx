import type { UniqueIdentifier } from '@dnd-kit/core';
import { AnimateLayoutChanges, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CSSProperties } from 'react';

import { iOS } from '../../utilities';
import { TreeItem, Props as TreeItemProps } from './TreeItem';

interface Props extends TreeItemProps {
    id: UniqueIdentifier;
    onRegisterNode?(id: UniqueIdentifier, node: HTMLElement | null): void;
}

const animateLayoutChanges: AnimateLayoutChanges = ({ isSorting, wasDragging }) => (isSorting || wasDragging ? false : true);

export function SortableTreeItem({ id, depth, onRegisterNode, ...props }: Props) {
    const { attributes, isDragging, isSorting, listeners, setDraggableNodeRef, setDroppableNodeRef, transform, transition } = useSortable({
        id,
        animateLayoutChanges,
    });
    const style: CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition,
    };

    const wrapperRef = (node: HTMLLIElement | null) => {
        setDroppableNodeRef(node);
        onRegisterNode?.(id, node);
    };

    return (
        <TreeItem
            ref={setDraggableNodeRef}
            wrapperRef={wrapperRef}
            style={style}
            depth={depth}
            ghost={isDragging}
            disableSelection={iOS}
            disableInteraction={isSorting}
            handleProps={{
                ...attributes,
                ...listeners,
            }}
            {...props}
        />
    );
}
