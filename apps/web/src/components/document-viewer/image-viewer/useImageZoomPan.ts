import { useCallback, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.4;

function clampScale(prev: number, next: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
}

export function useImageZoomPan() {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const hasDragged = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const isZoomed = scale > 1;

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

            isDragging.current = true;
            hasDragged.current = false;
            dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        },
        [isZoomed, translate],
    );

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging.current) return;

        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;

        if (Math.abs(dx) + Math.abs(dy) > 3) {
            hasDragged.current = true;
        }

        setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
    }, []);

    const handlePointerUp = useCallback(() => {
        isDragging.current = false;
    }, []);

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
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
        },
    };
}
