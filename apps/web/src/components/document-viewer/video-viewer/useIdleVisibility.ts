import { useEffect, useState, type RefObject } from 'react';

const IDLE_MS = 2500;

/**
 * Whether an overlay on a `<video controls>` should show: the native bar's own visibility is not readable from script,
 * so this follows what drives it: pointer or key activity over `containerRef` or a paused video shows it, and it hides
 * after a quiet spell while playing. `hold` keeps it up (an open menu).
 */
export function useIdleVisibility(containerRef: RefObject<HTMLElement | null>, videoRef: RefObject<HTMLVideoElement | null>, hold: boolean): boolean {
    const [active, setActive] = useState(true);

    useEffect(() => {
        const container = containerRef.current;
        const video = videoRef.current;

        if (!container || !video) return;

        let timer: ReturnType<typeof setTimeout> | undefined;

        const settle = () => {
            clearTimeout(timer);

            if (video.paused || video.ended) return setActive(true);

            timer = setTimeout(() => setActive(false), IDLE_MS);
        };

        const wake = () => {
            setActive(true);
            settle();
        };

        const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const;

        events.forEach((name) => container.addEventListener(name, wake));
        container.addEventListener('pointerleave', settle);
        video.addEventListener('play', wake);
        video.addEventListener('pause', wake);
        video.addEventListener('ended', wake);

        return () => {
            clearTimeout(timer);
            events.forEach((name) => container.removeEventListener(name, wake));
            container.removeEventListener('pointerleave', settle);
            video.removeEventListener('play', wake);
            video.removeEventListener('pause', wake);
            video.removeEventListener('ended', wake);
        };
    }, [containerRef, videoRef]);

    return active || hold;
}
