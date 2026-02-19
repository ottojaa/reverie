import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';

const PULSE_DURATION_MS = 2000;

export function PulseOverlay({ onComplete }: { onComplete?: (() => void) | undefined }) {
    const hasPulsedRef = useRef(false);

    useEffect(() => {
        if (!onComplete || hasPulsedRef.current) return;

        hasPulsedRef.current = true;
        let completed = false;
        const timer = setTimeout(() => {
            completed = true;
            onComplete();
        }, PULSE_DURATION_MS);

        return () => {
            clearTimeout(timer);

            if (!completed) onComplete();
        };
    }, [onComplete]);

    return (
        <motion.div className="pointer-events-none absolute inset-0 z-11 overflow-hidden rounded-md" aria-hidden>
            <motion.div
                className="absolute inset-y-0 w-[60%]"
                style={{
                    background: 'linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--primary) 45%, transparent) 50%, transparent 100%)',
                }}
                initial={{ x: '-70%' }}
                animate={{ x: '170%' }}
                transition={{ duration: PULSE_DURATION_MS / 1000, ease: [0.32, 0.72, 0, 1] }}
            />
        </motion.div>
    );
}
