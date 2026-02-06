import type { UniqueIdentifier } from '@dnd-kit/core';
import { AnimateLayoutChanges, useSortable } from '@dnd-kit/sortable';

import { iOS } from '../../utilities';
import { TreeItem, Props as TreeItemProps } from './TreeItem';

interface Props extends TreeItemProps {
    id: UniqueIdentifier;
    onRegisterNode?(id: UniqueIdentifier, node: HTMLElement | null): void;
}

const animateLayoutChanges: AnimateLayoutChanges = ({ isSorting, wasDragging }) => (isSorting || wasDragging ? true : true);

export function SortableTreeItem({ id, depth, onRegisterNode, dropZone, isHighlighted, ...props }: Props) {
    const { attributes, isDragging, isSorting, listeners, setDraggableNodeRef, setDroppableNodeRef } = useSortable({
        id,
        animateLayoutChanges,
    });
    const wrapperRef = (node: HTMLLIElement | null) => {
        setDroppableNodeRef(node);
        onRegisterNode?.(id, node);
    };

    return (
        <TreeItem
            ref={setDraggableNodeRef}
            wrapperRef={wrapperRef}
            depth={depth}
            ghost={isDragging}
            disableSelection={iOS}
            disableInteraction={isSorting}
            dropZone={dropZone}
            isHighlighted={isHighlighted}
            handleProps={{
                ...attributes,
                ...listeners,
            }}
            {...props}
        />
    );
}
