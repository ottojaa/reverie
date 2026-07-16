import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { releaseReturnShield } from '../dive/returnShield.js';
import { requestFrame } from './dampers.js';

/**
 * Drops the back-navigation shield once the GPU has provably executed the
 * scene's first frame. rAF ticks alone lied: frame one queues context setup,
 * shader compilation and texture uploads, and the compositor can put the
 * brand-new (uninitialized → white) surface on screen long before that work
 * finishes. A GL fence signals actual completion; one extra frame covers the
 * swap that displays it.
 */
export function ReturnShieldRelease() {
    const gl = useThree((s) => s.gl);
    const stateRef = useRef({ frames: 0, sync: null as WebGLSync | null, done: false });

    useFrame(() => {
        const s = stateRef.current;

        if (s.done) return;

        // Fence polling needs frames to keep coming — self-sustain so the
        // release also works under frameloop="demand" (mobile).
        requestFrame();
        s.frames += 1;
        const ctx = gl.getContext();

        if (typeof WebGL2RenderingContext === 'undefined' || !(ctx instanceof WebGL2RenderingContext)) {
            // WebGL1 fallback: a handful of frames is the best proxy available.
            if (s.frames >= 8) {
                s.done = true;
                releaseReturnShield();
            }

            return;
        }

        // Let the first full frame queue its commands before fencing.
        if (s.frames < 2) return;

        if (!s.sync) {
            s.sync = ctx.fenceSync(ctx.SYNC_GPU_COMMANDS_COMPLETE, 0);
            ctx.flush();

            return;
        }

        const status = ctx.clientWaitSync(s.sync, 0, 0);

        if (status !== ctx.ALREADY_SIGNALED && status !== ctx.CONDITION_SATISFIED) return;

        ctx.deleteSync(s.sync);
        s.sync = null;
        s.done = true;
        requestAnimationFrame(() => releaseReturnShield());
    });

    return null;
}
