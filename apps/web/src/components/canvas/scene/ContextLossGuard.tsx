import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { requestFrame } from './dampers.js';

/** Prevents the default context-loss teardown and repaints on restore. */
export function ContextLossGuard() {
    const gl = useThree((s) => s.gl);

    useEffect(() => {
        const el = gl.domElement;
        const onLost = (e: Event) => e.preventDefault();
        const onRestored = () => requestFrame();

        el.addEventListener('webglcontextlost', onLost);
        el.addEventListener('webglcontextrestored', onRestored);

        return () => {
            el.removeEventListener('webglcontextlost', onLost);
            el.removeEventListener('webglcontextrestored', onRestored);
        };
    }, [gl]);

    return null;
}
