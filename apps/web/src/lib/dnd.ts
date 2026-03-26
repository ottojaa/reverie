import { KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';

export const dndMeasuring = {
    droppable: {
        strategy: MeasuringStrategy.Always,
    },
};

const mouseActivationConstraint = { delay: 200, tolerance: 2 };
/** Long press + small tolerance: scroll wins if finger moves during the window; drag only after deliberate hold (Notion-like). */
const touchActivationConstraint = { delay: 500, tolerance: 4 };

/** No-op keyboard coordinate getter so sensors array length stays 3 (matches tree's Mouse + Touch + Keyboard). */
function noopKeyboardCoordinateGetter() {
    return undefined;
}

/** Default sensors for Layout DndContext. Must have same length (3) as tree sensors to avoid useEffect size change error. */
export function useDefaultSensors() {
    return useSensors(
        useSensor(MouseSensor, { activationConstraint: mouseActivationConstraint }),
        useSensor(TouchSensor, { activationConstraint: touchActivationConstraint }),
        useSensor(KeyboardSensor, { coordinateGetter: noopKeyboardCoordinateGetter }),
    );
}
