import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import type { ViewerProps } from './viewer-registry';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.4;

export default function ImageViewer({ document, fileUrl }: ViewerProps) {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isLoaded, setIsLoaded] = useState(false);
    const isDragging = useRef(false);
    const hasDragged = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    const isZoomed = scale > 1;

    /** Single click: toggle between 1x and 2.5x */
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            // Skip if it was a drag gesture
            if (hasDragged.current) {
                hasDragged.current = false;

                return;
            }

            if (isZoomed) {
                setScale(1);
                setTranslate({ x: 0, y: 0 });
            } else {
                // Zoom towards click point
                const rect = containerRef.current?.getBoundingClientRect();

                if (rect) {
                    const cx = e.clientX - rect.left - rect.width / 2;
                    const cy = e.clientY - rect.top - rect.height / 2;
                    setTranslate({ x: -cx, y: -cy });
                }

                setScale(2.5);
            }
        },
        [isZoomed],
    );

    /** Wheel + trackpad pinch (ctrlKey) zoom */
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();

        // Trackpad pinch fires wheel with ctrlKey=true
        if (e.ctrlKey) {
            const pinchDelta = -e.deltaY * 0.01;
            setScale((prev) => {
                const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * (1 + pinchDelta)));

                if (next <= MIN_SCALE + 0.05) {
                    setTranslate({ x: 0, y: 0 });

                    return MIN_SCALE;
                }

                return next;
            });
        } else {
            // Regular scroll wheel
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
            setScale((prev) => {
                const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));

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

        // Only count as a real drag after 3px threshold
        if (Math.abs(dx) + Math.abs(dy) > 3) {
            hasDragged.current = true;
        }

        setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
    }, []);

    const handlePointerUp = useCallback(() => {
        isDragging.current = false;
    }, []);

    // Build thumbnail URL for blur-up
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const thumbnailUrl = document.thumbnail_urls?.lg ? `${API_BASE}${document.thumbnail_urls.lg}` : null;

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex h-full w-full items-center justify-center overflow-hidden',
                isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onClick={handleClick}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Blur-up placeholder from thumbnail */}
            {thumbnailUrl && !isLoaded && (
                <img
                    src={thumbnailUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 m-auto max-h-full max-w-full object-contain blur-xl scale-105 opacity-60"
                />
            )}

            {/* Entrance animation wrapper — only controls opacity, no transform */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isLoaded ? 1 : 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center justify-center"
            >
                {/* Plain img — owns all transform for zoom/pan (no motion conflict) */}
                <img
                    src={fileUrl}
                    alt={document.original_filename}
                    onLoad={() => setIsLoaded(true)}
                    style={{
                        transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
                        transition: hasDragged.current ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                    className="max-h-[calc(100vh-4rem)] max-w-full select-none object-contain"
                    draggable={false}
                />
            </motion.div>

            {/* Zoom indicator */}
            {isZoomed && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
                >
                    {Math.round(scale * 100)}%
                </motion.div>
            )}
        </div>
    );
}
