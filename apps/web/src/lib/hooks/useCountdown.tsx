import { useEffect, useRef, useState } from 'react';

export function useCountdown() {
    const [seconds, setSeconds] = useState<number>(0);
    const [isCounting, setIsCounting] = useState<boolean>(false);

    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!isCounting) return;

        intervalRef.current = setInterval(() => {
            setSeconds((prev) => prev - 1);
        }, 1000);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }

            setSeconds(0);
            setIsCounting(false);
        };
    }, [isCounting]);

    return {
        seconds,
        isCounting,
        startCountdown: (seconds: number) => {
            setIsCounting(true);
            setSeconds(seconds);
        },
        stopCountdown: () => {
            setIsCounting(false);
        },
    };
}
