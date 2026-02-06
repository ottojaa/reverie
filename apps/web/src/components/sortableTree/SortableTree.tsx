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
    PointerSensor,
    TouchSensor,
    UniqueIdentifier,
    closestCenter,
    defaultDropAnimation,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePrefetchDocuments } from '@/lib/api/documents';
import { findSectionById } from '@/lib/sections';
import { CSS } from '@dnd-kit/utilities';
import type { FolderWithChildren } from '@reverie/shared';
import { SortableTreeItem } from './components';
import { sortableTreeKeyboardCoordinates } from './keyboardCoordinates';
import type { DropZone, FlattenedItem, SensorContext, TreeItems } from './types';
import {
    extractItem,
    flattenTree,
    getChildCount,
    getDropZone,
    getProjection,
    getTreeIds,
    insertItem,
    removeChildrenOf,
    removeItem,
    setProperty,
} from './utilities';

function sectionsToTreeItems(sections: FolderWithChildren[]): TreeItems {
    return sections.map((s) => ({
        id: s.id,
        children: sectionsToTreeItems(s.children),
    })) as TreeItems;
}

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
    currentSectionId?: string | undefined;
    defaultItems?: TreeItems;
    indentationWidth?: number;
    indicator?: boolean;
    onAddSubSection?: (section: FolderWithChildren) => void;
    onDeleteSection?: (section: FolderWithChildren) => void;
    onEditSection?: (section: FolderWithChildren) => void;
    onSectionsChange?: (newItems: TreeItems) => void;
    removable?: boolean;
    sections?: FolderWithChildren[] | null;
}

export function SortableTree({
    collapsible,
    currentSectionId,
    defaultItems = [],
    indicator = true,
    indentationWidth = 30,
    onAddSubSection,
    onDeleteSection,
    onEditSection,
    onSectionsChange,
    removable,
    sections,
}: Props) {
    const initialItemsFromSections = sections && sections.length > 0 ? sectionsToTreeItems(sections) : defaultItems;
    const [items, setItems] = useState(() => initialItemsFromSections);
    const itemsRef = useRef(items);
    itemsRef.current = items;

    useEffect(() => {
        if (!sections || sections.length === 0) return;
        const sectionsTree = sectionsToTreeItems(sections);
        const currentIds = getTreeIds(itemsRef.current);
        const newIds = getTreeIds(sectionsTree);
        // Only overwrite when structure changed (add/remove nodes). Same ids = reorder only → keep local order.
        if (currentIds.size === newIds.size && [...currentIds].every((id) => newIds.has(id))) {
            return;
        }
        setItems(sectionsTree);
    }, [sections]);

    const prefetchDocuments = usePrefetchDocuments();
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
    const [dropZone, setDropZone] = useState<DropZone | null>(null);
    const [currentPosition, setCurrentPosition] = useState<{
        parentId: UniqueIdentifier | null;
        overId: UniqueIdentifier;
    } | null>(null);
    const overRectRef = useRef<{ top: number; height: number } | null>(null);

    const flattenedItems = useMemo(() => {
        const flattenedTree = flattenTree(items);
        const collapsedItems = flattenedTree.reduce<UniqueIdentifier[]>(
            (acc, { children, collapsed, id }) => (collapsed && children.length ? [...acc, id] : acc),
            [],
        );

        return removeChildrenOf(flattenedTree, activeId != null ? [activeId, ...collapsedItems] : collapsedItems);
    }, [activeId, items]);

    const highlightedId = useMemo(() => {
        if (dropZone !== 'center' || !overId) return null;
        return overId;
    }, [dropZone, overId]);

    const sensorContext: SensorContext = useRef({
        items: flattenedItems,
    });
    const [coordinateGetter] = useState(() => sortableTreeKeyboardCoordinates(sensorContext, indicator, indentationWidth));
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { delay: 100, tolerance: 10 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 10 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter,
        }),
    );

    const sortedIds = useMemo(() => flattenedItems.map(({ id }) => id), [flattenedItems]);
    const activeItem = activeId ? flattenedItems.find(({ id }) => id === activeId) : null;

    useEffect(() => {
        sensorContext.current = {
            items: flattenedItems,
        };
    }, [flattenedItems]);

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
                {flattenedItems.map(({ id, children, collapsed, depth }) => {
                    const section = sections ? (findSectionById(sections, String(id)) ?? undefined) : undefined;
                    return (
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
                            dropZone={id === overId ? dropZone : null}
                            isHighlighted={highlightedId === id}
                            onSectionHover={prefetchDocuments}
                            {...(section !== undefined && { section })}
                            {...(currentSectionId !== undefined && { currentSectionId })}
                            {...(onEditSection !== undefined && { onEditSection })}
                            {...(onAddSubSection !== undefined && { onAddSubSection })}
                            {...(onDeleteSection !== undefined && { onDeleteSection })}
                        />
                    );
                })}
                {createPortal(
                    <DragOverlay dropAnimation={dropAnimationConfig}>
                        {activeId && activeItem
                            ? (() => {
                                  const overlaySection = sections ? (findSectionById(sections, String(activeId)) ?? undefined) : undefined;
                                  return (
                                      <SortableTreeItem
                                          id={activeId}
                                          depth={activeItem.depth}
                                          clone
                                          childCount={getChildCount(items, activeId) + 1}
                                          value={activeId.toString()}
                                          indentationWidth={indentationWidth}
                                          {...(overlaySection !== undefined && { section: overlaySection })}
                                          {...(currentSectionId !== undefined && { currentSectionId })}
                                      />
                                  );
                              })()
                            : null}
                    </DragOverlay>,
                    document.body,
                )}
            </SortableContext>
        </DndContext>
    );

    function handleDragStart({ active: { id: activeId } }: DragStartEvent) {
        setActiveId(activeId);
        setOverId(activeId);
        setDropZone(null);
        overRectRef.current = null;

        const activeItem = flattenedItems.find(({ id }) => id === activeId);

        if (activeItem) {
            setCurrentPosition({
                parentId: activeItem.parentId,
                overId: activeId,
            });
        }

        document.body.style.setProperty('cursor', 'grabbing');
    }

    function handleDragMove({ delta, activatorEvent }: DragMoveEvent) {
        if (overId && overRectRef.current) {
            const pointerY = (activatorEvent as PointerEvent).clientY + delta.y;
            const zone = getDropZone(pointerY, overRectRef.current.top, overRectRef.current.height);
            setDropZone(zone);
        }
    }

    function handleDragOver({ over }: DragOverEvent) {
        setOverId(over?.id ?? null);
        overRectRef.current = over?.rect ? { top: over.rect.top, height: over.rect.height } : null;
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        const finalOverId = over?.id ?? null;
        const finalDropZone = dropZone;
        const finalProjected = activeId && finalOverId && finalDropZone != null ? getProjection(flattenedItems, active.id, finalOverId, finalDropZone) : null;
        resetState();

        if (finalProjected && over) {
            const overItem = flattenedItems.find(({ id }) => id === over.id);

            if (!overItem) return;

            const { tree: treeWithoutActive, item: activeTreeItem } = extractItem(items, active.id);
            if (!activeTreeItem) return;

            const isInsertAsChild =
                finalDropZone === 'center' ||
                (finalDropZone === 'below' && flattenedItems[flattenedItems.findIndex(({ id }) => id === over.id)! + 1]?.parentId === over.id);

            let newItems: TreeItems;
            if (isInsertAsChild) {
                newItems = insertItem(treeWithoutActive, activeTreeItem, { parentId: over.id });
            } else if (finalDropZone === 'above') {
                newItems = insertItem(treeWithoutActive, activeTreeItem, {
                    parentId: overItem.parentId,
                    beforeId: over.id,
                });
            } else {
                newItems = insertItem(treeWithoutActive, activeTreeItem, {
                    parentId: overItem.parentId,
                    afterId: over.id,
                });
            }

            setItems(newItems);

            if (sections && onSectionsChange) {
                onSectionsChange(newItems);
            }
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
        const proj = overId && dropZone != null ? getProjection(flattenedItems, activeId, overId, dropZone) : null;
        if (overId && proj) {
            if (eventName !== 'onDragEnd') {
                if (currentPosition && proj.parentId === currentPosition.parentId && overId === currentPosition.overId) {
                    return;
                } else {
                    setCurrentPosition({
                        parentId: proj.parentId,
                        overId,
                    });
                }
            }

            const overIndex = flattenedItems.findIndex(({ id }) => id === overId);
            const previousItem = flattenedItems[overIndex - 1];
            const nextItem = flattenedItems[overIndex + 1];

            let announcement: string | undefined;
            const movedVerb = eventName === 'onDragEnd' ? 'dropped' : 'moved';
            const nestedVerb = eventName === 'onDragEnd' ? 'dropped' : 'nested';

            if (!previousItem && nextItem) {
                announcement = `${activeId} was ${movedVerb} before ${nextItem.id}.`;
            } else if (previousItem) {
                if (proj.depth > previousItem.depth) {
                    announcement = `${activeId} was ${nestedVerb} under ${previousItem.id}.`;
                } else {
                    let previousSibling: FlattenedItem | undefined = previousItem;
                    while (previousSibling && proj.depth < previousSibling.depth) {
                        const pid: UniqueIdentifier | null = previousSibling.parentId;
                        previousSibling = flattenedItems.find(({ id }) => id === pid);
                    }

                    if (previousSibling) {
                        announcement = `${activeId} was ${movedVerb} after ${previousSibling.id}.`;
                    }
                }
            }

            return announcement;
        }

        return;
    }
}
