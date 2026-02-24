import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerProps } from './viewer-registry';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.4;
const SPINNER_DELAY_MS = 150;

function ImageLoadingSpinner() {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="absolute inset-0 z-10 flex items-center justify-center"
            aria-label="Loading image"
        >
            <div className="relative">
                {/* Outer ring — smooth rotation with primary accent */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="size-8 rounded-full border-2 border-muted-foreground/20 border-t-primary"
                />
                {/* Inner pulse — subtle breathing glow */}
                <motion.div
                    animate={{ opacity: [0.25, 0.6, 0.25] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute inset-0 -m-2 rounded-full bg-primary/15"
                />
            </div>
        </motion.div>
    );
}

export default function ImageViewer({ document, fileUrl }: ViewerProps) {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const [isLoaded, setIsLoaded] = useState(false);
    const [showSpinner, setShowSpinner] = useState(false);
    const isDragging = useRef(false);
    const hasDragged = useRef(false);

    useEffect(() => {
        setIsLoaded(false);
        setShowSpinner(false);
        const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);

        return () => clearTimeout(t);
    }, [fileUrl]);
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

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex h-full w-full items-center justify-center overflow-hidden p-4 md:p-6',
                isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onClick={handleClick}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Loading overlay — only after delay to avoid flash on fast loads */}
            <AnimatePresence>{!isLoaded && showSpinner && <ImageLoadingSpinner key="image-loading" />}</AnimatePresence>

            {/* Entrance animation wrapper — crossfade with spinner exit */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isLoaded ? 1 : 0 }}
                transition={{
                    duration: isLoaded ? 0.55 : 0.2,
                    delay: isLoaded ? 0.08 : 0,
                    ease: [0.22, 1, 0.36, 1],
                }}
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
                    className="max-h-[calc(100vh-8rem)] max-w-full select-none rounded-lg object-contain"
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
