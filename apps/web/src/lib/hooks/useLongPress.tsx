import { useCallback, useEffect, useRef } from 'react';

type LongPressOptions = {
    threshold: number;
    enabled: boolean;
};

type LongPressHandlers = {
    onMouseDown: () => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onTouchStart: () => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
    onTouchCancel: () => void;
};

export const useLongPress = (callback: () => void, { threshold, enabled }: LongPressOptions): LongPressHandlers => {
    const timerRef = useRef<number | null>(null);
    const isLongPressActive = useRef(false);

    const start = useCallback(() => {
        if (enabled) {
            timerRef.current = window.setTimeout(() => {
                isLongPressActive.current = true;
                callback();
            }, threshold);
        }
    }, [callback, threshold, enabled]);

    const clear = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        isLongPressActive.current = false;
    }, []);

    useEffect(() => {
        return () => {
            clear();
        };
    }, [clear]);

    return {
        onMouseDown: start,
        onMouseUp: clear,
        onMouseLeave: clear,
        onTouchStart: start,
        onTouchEnd: clear,
        onTouchMove: clear,
        onTouchCancel: clear,
    };
};
