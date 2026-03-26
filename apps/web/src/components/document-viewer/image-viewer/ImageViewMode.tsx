import { getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Blurhash } from 'react-blurhash';
import type { ViewerProps } from '../viewer-registry';
import { ImageLoadingSpinner } from './ImageLoadingSpinner';
import { useImageZoomPan } from './useImageZoomPan';

const SPINNER_DELAY_MS = 150;

export function ImageViewMode({ document, fileUrl }: ViewerProps) {
    const thumbUrl = useMemo(() => {
        if (document.thumbnail_status !== 'complete') return null;

        return getThumbnailUrl(document, 'lg');
    }, [document]);

    const [previewReady, setPreviewReady] = useState(false);
    const [fullReady, setFullReady] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);

    const useProgressive = thumbUrl !== null && thumbUrl !== fileUrl && !previewFailed;
    const [showSpinner, setShowSpinner] = useState(false);

    const { scale, translate, isZoomed, hasDragged, containerRef, handlers } = useImageZoomPan();

    const hasFirstPaint = useProgressive ? previewReady || fullReady : fullReady;

    useEffect(() => {
        setPreviewReady(false);
        setFullReady(false);
        setPreviewFailed(false);
        setShowSpinner(false);
        const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);

        return () => clearTimeout(t);
    }, [fileUrl, thumbUrl, useProgressive]);

    const transformStyle = {
        transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
        transition: hasDragged.current ? 'none' : ('transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)' as const),
    };

    const imgClass = 'max-h-full max-w-full select-none rounded-lg object-contain';

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden p-4 md:p-6',
                !hasFirstPaint ? 'cursor-default' : isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onClick={hasFirstPaint ? handlers.onClick : undefined}
            onWheel={hasFirstPaint ? handlers.onWheel : undefined}
            onPointerDown={hasFirstPaint ? handlers.onPointerDown : undefined}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
        >
            <AnimatePresence>{!hasFirstPaint && showSpinner && <ImageLoadingSpinner key="image-loading" />}</AnimatePresence>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: hasFirstPaint ? 1 : 0 }}
                transition={{
                    duration: hasFirstPaint ? 0.22 : 0.15,
                    ease: [0.22, 1, 0.36, 1],
                }}
                className="relative flex min-h-0 max-h-full w-full items-center justify-center"
            >
                <div
                    className="relative inline-block max-h-full max-w-full"
                    style={{
                        ...transformStyle,
                        ...(document.width && document.height
                            ? { aspectRatio: `${document.width} / ${document.height}` }
                            : { minHeight: 'min(40vh, 240px)', minWidth: 'min(90vw, 320px)' }),
                    }}
                >
                    {useProgressive && thumbUrl && (
                        <>
                            {document.thumbnail_blurhash && !previewReady && (
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg" aria-hidden>
                                    <Blurhash
                                        hash={document.thumbnail_blurhash}
                                        width={Math.min(document.width ?? 800, 800)}
                                        height={Math.min(document.height ?? 600, 600)}
                                        resolutionX={32}
                                        resolutionY={32}
                                        punch={1}
                                        className="max-h-full max-w-full object-contain"
                                    />
                                </div>
                            )}
                            <img
                                src={thumbUrl}
                                alt=""
                                fetchPriority="high"
                                decoding="async"
                                onLoad={() => setPreviewReady(true)}
                                onError={() => setPreviewFailed(true)}
                                style={{
                                    opacity: fullReady ? 0 : 1,
                                    transition: hasDragged.current ? 'none' : 'opacity 0.35s ease-out',
                                }}
                                className={imgClass}
                                draggable={false}
                            />
                        </>
                    )}

                    <img
                        src={fileUrl}
                        alt={document.original_filename}
                        fetchPriority={useProgressive ? 'auto' : 'high'}
                        decoding="async"
                        onLoad={() => setFullReady(true)}
                        style={{
                            opacity: useProgressive ? (fullReady ? 1 : 0) : fullReady ? 1 : 0,
                            transition: hasDragged.current ? 'none' : 'opacity 0.4s ease-out',
                            ...(useProgressive
                                ? {
                                      position: 'absolute',
                                      left: 0,
                                      top: 0,
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'contain',
                                  }
                                : {}),
                        }}
                        className={cn(imgClass, useProgressive && 'h-full w-full')}
                        draggable={false}
                    />
                </div>
            </motion.div>

            {isZoomed && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="pointer-events-none absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
                >
                    {Math.round(scale * 100)}%
                </motion.div>
            )}
        </div>
    );
}
