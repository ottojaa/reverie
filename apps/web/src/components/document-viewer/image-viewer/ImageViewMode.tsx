import { getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Blurhash } from 'react-blurhash';
import type { ViewerProps } from '../viewer-registry';
import { ImageLoadingSpinner } from './ImageLoadingSpinner';
import { useImageZoomPan } from './useImageZoomPan';

const SPINNER_DELAY_MS = 150;

function isCached(src: string | null): boolean {
    if (!src) return false;

    const img = new Image();
    img.src = src;

    return img.complete;
}

export function ImageViewMode({ document, fileUrl }: ViewerProps) {
    const thumbUrl = useMemo(() => {
        if (document.thumbnail_status !== 'complete') return null;

        return getThumbnailUrl(document, 'lg');
    }, [document]);

    const [previewReady, setPreviewReady] = useState(() => isCached(thumbUrl));
    const [fullReady, setFullReady] = useState(() => isCached(fileUrl));
    const [previewFailed, setPreviewFailed] = useState(false);

    // Locked URLs: only update when navigating to a different document.
    // Signed-URL refreshes (same document.id, new HMAC token) must not update img src,
    // because changing src blanks the element while the browser re-fetches — causing the flash.
    const [lockedThumbUrl, setLockedThumbUrl] = useState(thumbUrl);
    const [lockedFileUrl, setLockedFileUrl] = useState(fileUrl);

    const useProgressive = thumbUrl !== null && thumbUrl !== fileUrl && !previewFailed;
    const [showSpinner, setShowSpinner] = useState(false);

    const { scale, translate, isZoomed, hasDragged, containerRef, handlers } = useImageZoomPan();

    const hasFirstPaint = useProgressive ? previewReady || fullReady : fullReady;

    useEffect(() => {
        const thumbHit = isCached(thumbUrl);
        const fullHit = isCached(fileUrl);
        setPreviewReady(thumbHit);
        setFullReady(fullHit);
        setPreviewFailed(false);
        setShowSpinner(false);
        setLockedThumbUrl(thumbUrl);
        setLockedFileUrl(fileUrl);

        if (fullHit || thumbHit) return;

        const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);

        return () => clearTimeout(t);
        // Only reset when navigating to a different document, not on signed-URL refresh
    }, [document.id]); // intentional: fileUrl/thumbUrl excluded — signed-URL refreshes must not reset state

    // translate3d + contain/backface: Chromium/Electron often leaves "ghost" streaks when panning
    // zoomed images under nested overflow:hidden; these props constrain compositor invalidation.
    const transformStyle = {
        transform: `scale(${scale}) translate3d(${translate.x / scale}px, ${translate.y / scale}px, 0)`,
        transition: hasDragged.current ? 'none' : ('transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)' as const),
        contain: 'paint' as const,
        backfaceVisibility: 'hidden' as const,
    };

    const imgClass = 'max-h-full max-w-full select-none rounded-lg object-contain';

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex h-full min-h-0 w-full items-stretch justify-center overflow-hidden px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:pt-6 md:pb-[max(2rem,env(safe-area-inset-bottom))]',
                !hasFirstPaint ? 'cursor-default' : isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onClick={hasFirstPaint ? handlers.onClick : undefined}
            onWheel={hasFirstPaint ? handlers.onWheel : undefined}
            onPointerDown={hasFirstPaint ? handlers.onPointerDown : undefined}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
        >
            <AnimatePresence>
                {!hasFirstPaint && showSpinner && !useProgressive && !document.thumbnail_blurhash && <ImageLoadingSpinner key="image-loading" />}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: hasFirstPaint ? 1 : 0 }}
                animate={{ opacity: hasFirstPaint ? 1 : 0 }}
                transition={{
                    duration: 0.22,
                    ease: [0.22, 1, 0.36, 1],
                }}
                className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden contain-[paint]"
            >
                <div
                    className={cn(
                        'relative m-1 box-border min-h-0 min-w-0 max-h-full max-w-full overflow-hidden',
                        document.width && document.height && 'h-auto w-auto max-w-full',
                    )}
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
                                src={lockedThumbUrl ?? undefined}
                                alt=""
                                fetchPriority="high"
                                decoding="async"
                                onLoad={() => setPreviewReady(true)}
                                onError={() => setPreviewFailed(true)}
                                style={{ opacity: 1 }}
                                className={imgClass}
                                draggable={false}
                            />
                        </>
                    )}

                    <img
                        src={lockedFileUrl ?? undefined}
                        alt={document.original_filename}
                        fetchPriority={useProgressive ? 'auto' : 'high'}
                        decoding="async"
                        onLoad={() => setFullReady(true)}
                        style={{
                            opacity: fullReady ? 1 : 0,
                            transition: hasDragged.current ? 'none' : 'opacity 0.15s ease-out',
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
