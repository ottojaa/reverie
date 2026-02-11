import { useEffect, useState } from 'react';

/** Touch-first devices (phones, tablets) via (pointer: coarse). */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    );

    useEffect(() => {
        const mq = window.matchMedia('(pointer: coarse)');
        const fn = () => setIsMobile(mq.matches);
        mq.addEventListener('change', fn);

        return () => mq.removeEventListener('change', fn);
    }, []);

    return isMobile;
}
