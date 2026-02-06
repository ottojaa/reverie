import { closestCorners, DroppableContainer, getFirstCollision, KeyboardCode, KeyboardCoordinateGetter } from '@dnd-kit/core';

import type { SensorContext } from './types';

const directions: string[] = [KeyboardCode.Down, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Left];

export const sortableTreeKeyboardCoordinates: (context: SensorContext, indicator: boolean, indentationWidth: number) => KeyboardCoordinateGetter =
    (context, indicator, indentationWidth) =>
    (event, { currentCoordinates, context: { active, over, collisionRect, droppableRects, droppableContainers } }) => {
        if (directions.includes(event.code)) {
            if (!active || !collisionRect) {
                return;
            }

            event.preventDefault();

            const {
                current: { items },
            } = context;

            // Left/Right arrows are now disabled for keyboard navigation
            // since depth changes are only via drop zones (center vs above/below)
            // In the future, could map Right = move to center zone, Left = unnest
            if (event.code === KeyboardCode.Left || event.code === KeyboardCode.Right) {
                return undefined;
            }

            const containers: DroppableContainer[] = [];

            droppableContainers.forEach((container) => {
                if (container?.disabled || container.id === over?.id) {
                    return;
                }

                const rect = droppableRects.get(container.id);

                if (!rect) {
                    return;
                }

                switch (event.code) {
                    case KeyboardCode.Down:
                        if (collisionRect.top < rect.top) {
                            containers.push(container);
                        }
                        break;
                    case KeyboardCode.Up:
                        if (collisionRect.top > rect.top) {
                            containers.push(container);
                        }
                        break;
                }
            });

            const collisions = closestCorners({
                active,
                collisionRect,
                pointerCoordinates: null,
                droppableRects,
                droppableContainers: containers,
            });
            let closestId = getFirstCollision(collisions, 'id');

            if (closestId === over?.id && collisions?.[1]) {
                closestId = collisions[1].id;
            }

            if (closestId && over?.id) {
                const activeRect = droppableRects.get(active.id);
                const newRect = droppableRects.get(closestId);
                const newDroppable = droppableContainers.get(closestId);

                if (activeRect && newRect && newDroppable) {
                    const newIndex = items.findIndex(({ id }) => id === closestId);
                    const newItem = items[newIndex];

                    if (newItem) {
                        const isBelow = newIndex > (items.findIndex(({ id }) => id === active.id) ?? 0);
                        const modifier = isBelow ? 1 : -1;
                        const offset = indicator ? (collisionRect.height - activeRect.height) / 2 : 0;

                        const newCoordinates = {
                            x: newRect.left + newItem.depth * indentationWidth,
                            y: newRect.top + modifier * offset,
                        };

                        return newCoordinates;
                    }
                }
            }
        }

        return undefined;
    };
