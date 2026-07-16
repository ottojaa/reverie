import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { requestFrame, setInvalidator, updateDampers } from './dampers.js';

/** Wires the damper registry into R3F's demand frameloop. */
export function FrameDriver() {
    const invalidate = useThree((s) => s.invalidate);

    useEffect(() => {
        setInvalidator(() => invalidate());

        return () => setInvalidator(null);
    }, [invalidate]);

    useFrame((_, dt) => {
        if (updateDampers(Math.min(dt, 0.1))) requestFrame();
    });

    return null;
}
