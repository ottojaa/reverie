import { useEffect, useState } from 'react';

/** True once `active` has stayed true for `delayMs`: a placeholder that a fast load never shows, so it does not flash. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
    const [flag, setFlag] = useState(false);

    useEffect(() => {
        if (!active) {
            setFlag(false);

            return;
        }

        const timer = setTimeout(() => setFlag(true), delayMs);

        return () => clearTimeout(timer);
    }, [active, delayMs]);

    return flag;
}
