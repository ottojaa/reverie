import { useCallback, useEffect, useRef, useState } from 'react';

export function useCountdown() {
    const [seconds, setSeconds] = useState(0);
    const endTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        endTimeRef.current = null;
        setSeconds(0);
    }, []);

    const startCountdown = useCallback(
        (duration: number) => {
            stop();
            endTimeRef.current = Date.now() + duration * 1000;
            setSeconds(duration);

            intervalRef.current = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((endTimeRef.current! - Date.now()) / 1000));
                setSeconds(remaining);

                if (remaining <= 0) {
                    if (intervalRef.current) {
                        clearInterval(intervalRef.current);
                        intervalRef.current = null;
                    }

                    endTimeRef.current = null;
                }
            }, 500);
        },
        [stop],
    );

    // Cleanup on unmount
    useEffect(() => stop, [stop]);

    return {
        seconds,
        isCounting: seconds > 0,
        startCountdown,
        stopCountdown: stop,
    };
}
