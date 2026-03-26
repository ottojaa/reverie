import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.4;

function clampScale(prev: number, next: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
}

export function useImageZoomPan() {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const touchPanActiveRef = useRef(false);
    const pointerPanActiveRef = useRef(false);
    const hasDragged = useRef(false);
    const activePointerId = useRef<number | null>(null);
    const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const scaleRef = useRef(scale);
    const dragListenersCleanupRef = useRef<(() => void) | null>(null);
    const isZoomed = scale > 1;

    scaleRef.current = scale;

    // Touch listeners only call preventDefault on touchmove while zoomed (block native scroll).
    // Pan position always comes from PointerEvent + document listeners; DevTools often omits usable TouchEvent moves.
    useEffect(() => {
        const el = containerRef.current;

        if (!el) return;

        const onTouchStart = (e: TouchEvent) => {
            if (scaleRef.current <= 1) return;

            if (e.touches.length !== 1) {
                touchPanActiveRef.current = false;

                return;
            }

            touchPanActiveRef.current = true;
        };

        // Only block browser scroll — pan position comes from PointerEvent (see handlePointerDown).
        // DevTools may emit touchstart but not reliable touchmove; pointer path must not be skipped.
        const onTouchMove = (e: TouchEvent) => {
            if (!touchPanActiveRef.current) return;

            if (scaleRef.current <= 1) return;

            if (e.touches.length !== 1) return;

            e.preventDefault();
        };

        const onTouchEnd = () => {
            if (!touchPanActiveRef.current) return;

            touchPanActiveRef.current = false;
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        el.addEventListener('touchend', onTouchEnd, { capture: true });
        el.addEventListener('touchcancel', onTouchEnd, { capture: true });

        return () => {
            el.removeEventListener('touchstart', onTouchStart, { capture: true });
            el.removeEventListener('touchmove', onTouchMove, { capture: true });
            el.removeEventListener('touchend', onTouchEnd, { capture: true });
            el.removeEventListener('touchcancel', onTouchEnd, { capture: true });
        };
    }, []);

    useEffect(() => {
        return () => {
            dragListenersCleanupRef.current?.();
            dragListenersCleanupRef.current = null;
        };
    }, []);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            if (hasDragged.current) {
                hasDragged.current = false;

                return;
            }

            if (isZoomed) {
                setScale(1);
                setTranslate({ x: 0, y: 0 });

                return;
            }

            const rect = containerRef.current?.getBoundingClientRect();

            if (!rect) {
                setScale(2.5);

                return;
            }

            const cx = e.clientX - rect.left - rect.width / 2;
            const cy = e.clientY - rect.top - rect.height / 2;
            setTranslate({ x: -cx, y: -cy });
            setScale(2.5);
        },
        [isZoomed],
    );

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey) {
            const pinchDelta = -e.deltaY * 0.01;
            setScale((prev) => {
                const next = clampScale(prev, prev * (1 + pinchDelta));

                if (next <= MIN_SCALE + 0.05) {
                    setTranslate({ x: 0, y: 0 });

                    return MIN_SCALE;
                }

                return next;
            });
        } else {
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
            setScale((prev) => {
                const next = clampScale(prev, prev + delta);

                if (next === MIN_SCALE) setTranslate({ x: 0, y: 0 });

                return next;
            });
        }
    }, []);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (!isZoomed) return;

            if (!e.isPrimary) return;

            if (e.pointerType === 'mouse' && e.button !== 0) return;

            dragListenersCleanupRef.current?.();

            const usePointerTouchScrollBlock = e.pointerType === 'touch';

            // Stops the browser from treating the gesture as scroll, which cancels pointer streams (incl. DevTools).
            const blockTouchScrollWhilePointerPan = (te: TouchEvent) => {
                if (!pointerPanActiveRef.current) return;

                if (scaleRef.current <= 1) return;

                te.preventDefault();
            };

            pointerPanActiveRef.current = true;
            hasDragged.current = false;
            activePointerId.current = e.pointerId;
            dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };

            const el = containerRef.current;

            if (el) {
                try {
                    el.setPointerCapture(e.pointerId);
                } catch {
                    // Invalid pointer id — ignore
                }
            }

            if (usePointerTouchScrollBlock) {
                window.addEventListener('touchmove', blockTouchScrollWhilePointerPan, { capture: true, passive: false });
            }

            const move = (ev: PointerEvent) => {
                if (!pointerPanActiveRef.current || activePointerId.current !== ev.pointerId) return;

                const dx = ev.clientX - dragStart.current.x;
                const dy = ev.clientY - dragStart.current.y;

                if (Math.abs(dx) + Math.abs(dy) > 3) {
                    hasDragged.current = true;
                }

                setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
            };

            const end = (ev: PointerEvent) => {
                if (activePointerId.current !== ev.pointerId) return;

                document.removeEventListener('pointermove', move, true);
                document.removeEventListener('pointerup', end, true);
                document.removeEventListener('pointercancel', end, true);

                if (usePointerTouchScrollBlock) {
                    window.removeEventListener('touchmove', blockTouchScrollWhilePointerPan, { capture: true });
                }

                dragListenersCleanupRef.current = null;
                pointerPanActiveRef.current = false;
                activePointerId.current = null;
            };

            dragListenersCleanupRef.current = () => {
                document.removeEventListener('pointermove', move, true);
                document.removeEventListener('pointerup', end, true);
                document.removeEventListener('pointercancel', end, true);

                if (usePointerTouchScrollBlock) {
                    window.removeEventListener('touchmove', blockTouchScrollWhilePointerPan, { capture: true });
                }
            };

            document.addEventListener('pointermove', move, true);
            document.addEventListener('pointerup', end, true);
            document.addEventListener('pointercancel', end, true);
        },
        [isZoomed, translate],
    );

    return {
        scale,
        translate,
        isZoomed,
        hasDragged,
        containerRef,
        handlers: {
            onClick: handleClick,
            onWheel: handleWheel,
            onPointerDown: handlePointerDown,
        },
    };
}
