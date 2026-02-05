import {
    Announcements,
    DndContext,
    DragEndEvent,
    DragMoveEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    DropAnimation,
    KeyboardSensor,
    MeasuringStrategy,
    Modifier,
    PointerSensor,
    UniqueIdentifier,
    closestCenter,
    defaultDropAnimation,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CSS } from '@dnd-kit/utilities';
import { SortableTreeItem } from './components';
import { sortableTreeKeyboardCoordinates } from './keyboardCoordinates';
import type { FlattenedItem, SensorContext, TreeItems } from './types';
import {
    buildTree,
    flattenTree,
    getChildCount,
    getDropZone,
    getProjectionForDropZone,
    removeChildrenOf,
    removeItem,
    setProperty,
    type DropZone,
} from './utilities';

const initialItems: TreeItems = [
    {
        id: 'Home',
        children: [],
    },
    {
        id: 'Collections',
        children: [
            { id: 'Spring', children: [] },
            { id: 'Summer', children: [] },
            { id: 'Fall', children: [] },
            { id: 'Winter', children: [] },
        ],
    },
    {
        id: 'About Us',
        children: [],
    },
    {
        id: 'My Account',
        children: [
            { id: 'Addresses', children: [] },
            { id: 'Order History', children: [] },
        ],
    },
];

const measuring = {
    droppable: {
        strategy: MeasuringStrategy.Always,
    },
};

const dropAnimationConfig: DropAnimation = {
    keyframes({ transform }) {
        return [
            { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
            {
                opacity: 0,
                transform: CSS.Transform.toString({
                    ...transform.final,
                    x: transform.final.x + 5,
                    y: transform.final.y + 5,
                }),
            },
        ];
    },
    easing: 'ease-out',
    sideEffects({ active }) {
        active.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: defaultDropAnimation.duration,
            easing: defaultDropAnimation.easing,
        });
    },
};

interface Props {
    collapsible?: boolean;
    defaultItems?: TreeItems;
    indentationWidth?: number;
    indicator?: boolean;
    removable?: boolean;
}

export function SortableTree({ collapsible, defaultItems = initialItems, indicator = true, indentationWidth = 30, removable }: Props) {
    const [items, setItems] = useState(() => defaultItems);
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
    const [dropZone, setDropZone] = useState<DropZone | null>(null);
    const [currentPosition, setCurrentPosition] = useState<{
        parentId: UniqueIdentifier | null;
        overId: UniqueIdentifier;
    } | null>(null);

    // Refs for performance - avoid re-renders on every pointer move
    const pointerYRef = useRef<number>(0);
    const overRectRef = useRef<DOMRect | null>(null);
    const itemRefsMap = useRef<Map<UniqueIdentifier, HTMLElement>>(new Map());

    const flattenedItems = useMemo(() => {
        const flattenedTree = flattenTree(items);
        const collapsedItems = flattenedTree.reduce<UniqueIdentifier[]>(
            (acc, { children, collapsed, id }) => (collapsed && children.length ? [...acc, id] : acc),
            [],
        );

        return removeChildrenOf(flattenedTree, activeId != null ? [activeId, ...collapsedItems] : collapsedItems);
    }, [activeId, items]);

    const projected = activeId && overId && dropZone ? getProjectionForDropZone(flattenedItems, activeId, overId, dropZone) : null;
    const sensorContext: SensorContext = useRef({
        items: flattenedItems,
        offset: 0,
    });
    const [coordinateGetter] = useState(() => sortableTreeKeyboardCoordinates(sensorContext, indicator, indentationWidth));
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter,
        }),
    );

    const sortedIds = useMemo(() => flattenedItems.map(({ id }) => id), [flattenedItems]);
    const activeItem = activeId ? flattenedItems.find(({ id }) => id === activeId) : null;
    const overItem = overId ? flattenedItems.find(({ id }) => id === overId) : null;
    
    // Use adjusted over ID from projection for indicator positioning
    const indicatorOverId = projected?.adjustedOverId ?? overId;
    const indicatorOverItem = indicatorOverId ? flattenedItems.find(({ id }) => id === indicatorOverId) : null;
    const indicatorDropZone = projected?.dropZone ?? dropZone;

    useEffect(() => {
        sensorContext.current = {
            items: flattenedItems,
            offset: 0,
        };
    }, [flattenedItems]);

    // Track pointer Y during drag
    useEffect(() => {
        if (!activeId) return;

        const handlePointerMove = (e: PointerEvent) => {
            pointerYRef.current = e.clientY;
        };

        document.addEventListener('pointermove', handlePointerMove);
        return () => document.removeEventListener('pointermove', handlePointerMove);
    }, [activeId]);

    // rAF loop to compute drop zone efficiently
    useEffect(() => {
        if (!activeId || !overId) return;

        let rafId: number;
        let lastZone: DropZone | null = null;

        const updateDropZone = () => {
            const rect = overRectRef.current;
            if (rect) {
                const newZone = getDropZone(pointerYRef.current, rect.top, rect.height);
                if (newZone !== lastZone) {
                    lastZone = newZone;
                    setDropZone(newZone);
                }
            }
            rafId = requestAnimationFrame(updateDropZone);
        };

        rafId = requestAnimationFrame(updateDropZone);
        return () => cancelAnimationFrame(rafId);
    }, [activeId, overId]);

    // Update over rect when overId changes (use adjusted overId for positioning)
    useEffect(() => {
        if (!overId) {
            overRectRef.current = null;
            return;
        }

        // Use adjusted overId from projection if available
        const targetId = projected?.adjustedOverId ?? overId;
        const element = itemRefsMap.current.get(targetId);
        if (element) {
            overRectRef.current = element.getBoundingClientRect();
        }
    }, [overId, projected?.adjustedOverId]);

    // Re-measure on scroll to keep indicator position accurate
    useEffect(() => {
        if (!activeId || !overId) return;

        const handleScroll = () => {
            const targetId = projected?.adjustedOverId ?? overId;
            const element = itemRefsMap.current.get(targetId);
            if (element) {
                overRectRef.current = element.getBoundingClientRect();
            }
        };

        // Listen to scroll on the window and any scroll containers
        window.addEventListener('scroll', handleScroll, true);
        return () => window.removeEventListener('scroll', handleScroll, true);
    }, [activeId, overId, projected?.adjustedOverId]);

    const announcements: Announcements = {
        onDragStart({ active }) {
            return `Picked up ${active.id}.`;
        },
        onDragMove({ active, over }) {
            return getMovementAnnouncement('onDragMove', active.id, over?.id);
        },
        onDragOver({ active, over }) {
            return getMovementAnnouncement('onDragOver', active.id, over?.id);
        },
        onDragEnd({ active, over }) {
            return getMovementAnnouncement('onDragEnd', active.id, over?.id);
        },
        onDragCancel({ active }) {
            return `Moving was cancelled. ${active.id} was dropped in its original position.`;
        },
    };

    const registerItemRef = (id: UniqueIdentifier, element: HTMLElement | null) => {
        if (element) {
            itemRefsMap.current.set(id, element);
        } else {
            itemRefsMap.current.delete(id);
        }
    };

    return (
        <DndContext
            accessibility={{ announcements }}
            sensors={sensors}
            collisionDetection={closestCenter}
            measuring={measuring}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
                {flattenedItems.map(({ id, children, collapsed, depth }) => (
                    <SortableTreeItem
                        key={id}
                        id={id}
                        value={id}
                        depth={depth}
                        indentationWidth={indentationWidth}
                        indicator={indicator}
                        collapsed={Boolean(collapsed && children.length)}
                        onCollapse={collapsible && children.length ? () => handleCollapse(id) : () => {}}
                        onRemove={removable ? () => handleRemove(id) : () => {}}
                        isDropTarget={overId === id && dropZone === 'center'}
                        onRefChange={(el) => registerItemRef(id, el)}
                    />
                ))}
                {/* Indicator line for reorder (above/below zones) */}
                {indicator && indicatorOverItem && overRectRef.current && indicatorDropZone && indicatorDropZone !== 'center' && (
                    <div
                        style={{
                            position: 'fixed',
                            left: `${overRectRef.current.left + indentationWidth * indicatorOverItem.depth}px`,
                            top: indicatorDropZone === 'above' ? `${overRectRef.current.top}px` : `${overRectRef.current.bottom}px`,
                            width: `${overRectRef.current.width - indentationWidth * indicatorOverItem.depth}px`,
                            height: '2px',
                            backgroundColor: '#2389ff',
                            pointerEvents: 'none',
                            zIndex: 100,
                        }}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                left: '-8px',
                                top: '-4px',
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                border: '2px solid #2389ff',
                                backgroundColor: 'white',
                            }}
                        />
                    </div>
                )}
                {createPortal(
                    <DragOverlay dropAnimation={dropAnimationConfig} modifiers={indicator ? [adjustTranslate] : []}>
                        {activeId && activeItem ? (
                            <SortableTreeItem
                                id={activeId}
                                depth={activeItem.depth}
                                clone
                                childCount={getChildCount(items, activeId) + 1}
                                value={activeId.toString()}
                                indentationWidth={indentationWidth}
                            />
                        ) : null}
                    </DragOverlay>,
                    document.body,
                )}
            </SortableContext>
        </DndContext>
    );

    function handleDragStart({ active: { id: activeId } }: DragStartEvent) {
        setActiveId(activeId);
        setOverId(activeId);
        setDropZone('center'); // Default to center

        const activeItem = flattenedItems.find(({ id }) => id === activeId);

        if (activeItem) {
            setCurrentPosition({
                parentId: activeItem.parentId,
                overId: activeId,
            });
        }

        document.body.style.setProperty('cursor', 'grabbing');
    }

    function handleDragMove(_event: DragMoveEvent) {
        // No longer tracking horizontal offset
    }

    function handleDragOver({ over }: DragOverEvent) {
        setOverId(over?.id ?? null);
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        resetState();

        if (projected && over) {
            const { depth, parentId, adjustedOverId, dropZone: projectedDropZone } = projected;
            const clonedItems: FlattenedItem[] = JSON.parse(JSON.stringify(flattenTree(items)));
            
            // Use adjusted over ID if available (for special cases like reordering within parent)
            const targetOverId = adjustedOverId ?? over.id;
            const overIndex = clonedItems.findIndex(({ id }) => id === targetOverId);
            const activeIndex = clonedItems.findIndex(({ id }) => id === active.id);

            const activeTreeItem = clonedItems[activeIndex];

            if (!activeTreeItem || overIndex === -1) {
                return;
            }

            // Update the active item's depth and parent
            clonedItems[activeIndex] = { ...activeTreeItem, depth, parentId };

            let targetIndex = overIndex;

            // Calculate the correct target index based on drop zone
            if (projectedDropZone === 'below') {
                // For 'below', we want to insert after the over item
                // If moving down in the list, the target is overIndex
                // If moving up in the list, the target is overIndex + 1
                targetIndex = activeIndex < overIndex ? overIndex : overIndex + 1;
            } else if (projectedDropZone === 'center') {
                // For 'center' (nesting), insert as first child
                // Find the position right after the parent (over item)
                targetIndex = overIndex + 1;
            }
            // For 'above', targetIndex is already overIndex

            const sortedItems = arrayMove(clonedItems, activeIndex, targetIndex);
            const newItems = buildTree(sortedItems);

            setItems(newItems);
        }
    }

    function handleDragCancel() {
        resetState();
    }

    function resetState() {
        setOverId(null);
        setActiveId(null);
        setDropZone(null);
        setCurrentPosition(null);
        pointerYRef.current = 0;
        overRectRef.current = null;

        document.body.style.setProperty('cursor', '');
    }

    function handleRemove(id: UniqueIdentifier) {
        setItems((items) => removeItem(items, id));
    }

    function handleCollapse(id: UniqueIdentifier) {
        setItems((items) =>
            setProperty(items, id, 'collapsed', (value) => {
                return !value;
            }),
        );
    }

    function getMovementAnnouncement(eventName: string, activeId: UniqueIdentifier, overId?: UniqueIdentifier) {
        if (overId && projected) {
            if (eventName !== 'onDragEnd') {
                if (currentPosition && projected.parentId === currentPosition.parentId && overId === currentPosition.overId) {
                    return;
                } else {
                    setCurrentPosition({
                        parentId: projected.parentId,
                        overId,
                    });
                }
            }

            const movedVerb = eventName === 'onDragEnd' ? 'dropped' : 'moved';
            const nestedVerb = eventName === 'onDragEnd' ? 'dropped' : 'nested';
            const overItemName = flattenedItems.find(({ id }) => id === overId)?.id;

            if (projected.dropZone === 'center') {
                return `${activeId} was ${nestedVerb} under ${overItemName}.`;
            } else if (projected.dropZone === 'above') {
                return `${activeId} was ${movedVerb} before ${overItemName}.`;
            } else {
                return `${activeId} was ${movedVerb} after ${overItemName}.`;
            }
        }

        return;
    }
}

const adjustTranslate: Modifier = ({ transform }) => {
    return {
        ...transform,
        y: transform.y - 25,
    };
};
