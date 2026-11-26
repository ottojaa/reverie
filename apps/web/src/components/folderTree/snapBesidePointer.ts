import type { Modifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

/** Space between the pointer and the preview. */
const GAP = 12;

/** Places a drag preview just right of the pointer and level with it, or to its left where the window ends. */
export const snapBesidePointer: Modifier = ({ activatorEvent, draggingNodeRect, transform, windowRect }) => {
    const start = activatorEvent && getEventCoordinates(activatorEvent);

    if (!start || !draggingNodeRect || !windowRect) return transform;

    const pointer = { x: start.x + transform.x, y: start.y + transform.y };
    const { width, height } = draggingNodeRect;
    const fitsRight = pointer.x + GAP + width <= windowRect.width;
    const left = fitsRight ? pointer.x + GAP : pointer.x - GAP - width;
    const top = Math.min(Math.max(pointer.y - height / 2, 0), windowRect.height - height);

    return { ...transform, x: left - draggingNodeRect.left, y: top - draggingNodeRect.top };
};
