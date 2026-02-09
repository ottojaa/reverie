import type { UniqueIdentifier } from '@dnd-kit/core';
import { AnimateLayoutChanges, useSortable } from '@dnd-kit/sortable';

import type { IndicatorLineEdge, IndicatorType } from '../../utilities';
import { iOS } from '../../utilities';
import { TreeItem, Props as TreeItemProps } from './TreeItem';

interface Props extends TreeItemProps {
    id: UniqueIdentifier;
    indicatorType?: IndicatorType | null;
    indicatorLineEdge?: IndicatorLineEdge | undefined;
    onRegisterNode?(id: UniqueIdentifier, node: HTMLElement | null): void;
}

const animateLayoutChanges: AnimateLayoutChanges = ({ isSorting, wasDragging }) => (isSorting || wasDragging ? true : true);

export function SortableTreeItem({
    id,
    depth,
    onRegisterNode,
    indicatorType,
    indicatorLineEdge,
    isDropDisabled,
    isHighlighted,
    ...props
}: Props) {
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
            indicatorType={indicatorType ?? null}
            indicatorLineEdge={indicatorLineEdge}
            isDropDisabled={isDropDisabled ?? false}
            isHighlighted={isHighlighted}
            handleProps={{
                ...attributes,
                ...listeners,
            }}
            {...props}
        />
    );
}
