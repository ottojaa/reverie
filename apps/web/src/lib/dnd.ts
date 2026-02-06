import {
    KeyboardSensor,
    MeasuringStrategy,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';

export const dndMeasuring = {
    droppable: {
        strategy: MeasuringStrategy.Always,
    },
};

const activationConstraint = { delay: 100, tolerance: 10 };

/** No-op keyboard coordinate getter so sensors array length stays 3 (matches tree's Pointer + Touch + Keyboard). */
function noopKeyboardCoordinateGetter() {
    return undefined;
}

/** Default sensors for Layout DndContext. Must have same length (3) as tree sensors to avoid useEffect size change error. */
export function useDefaultSensors() {
    return useSensors(
        useSensor(PointerSensor, { activationConstraint }),
        useSensor(TouchSensor, { activationConstraint }),
        useSensor(KeyboardSensor, { coordinateGetter: noopKeyboardCoordinateGetter }),
    );
}
