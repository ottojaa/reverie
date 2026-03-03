import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ViewerProps } from '../viewer-registry';
import { ImageLoadingSpinner } from './ImageLoadingSpinner';
import { useImageZoomPan } from './useImageZoomPan';

const SPINNER_DELAY_MS = 150;

export function ImageViewMode({ document, fileUrl }: ViewerProps) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [showSpinner, setShowSpinner] = useState(false);
    const { scale, translate, isZoomed, hasDragged, containerRef, handlers } = useImageZoomPan();

    useEffect(() => {
        setIsLoaded(false);
        setShowSpinner(false);
        const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);

        return () => clearTimeout(t);
    }, [fileUrl]);

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex h-full w-full items-center justify-center overflow-hidden p-4 md:p-6',
                isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onClick={handlers.onClick}
            onWheel={handlers.onWheel}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
        >
            <AnimatePresence>{!isLoaded && showSpinner && <ImageLoadingSpinner key="image-loading" />}</AnimatePresence>

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
