import { API_BASE } from '@/lib/api/client';
import { documentsApi } from '@/lib/api/documents';
import { buildFileUrl } from '@/lib/commonhelpers';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ViewerProps } from '../viewer-registry';
import { QualityMenu } from './QualityMenu';
import { useHlsSource } from './useHlsSource';
import { useIdleVisibility } from './useIdleVisibility';

export function VideoViewMode({ document, fileUrl }: ViewerProps) {
    const queryClient = useQueryClient();
    const videoRef = useRef<HTMLVideoElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const documentId = document.id;

    // The renditions' token expires like the file URL's; a refetch signs them again.
    const refreshHlsUrl = useCallback(async () => {
        const fresh = await queryClient.fetchQuery({ queryKey: ['document', documentId], queryFn: () => documentsApi.get(documentId), staleTime: 0 });

        return buildFileUrl(fresh.hls_url);
    }, [queryClient, documentId]);

    const { src, levels, selected, playingLabel, selectQuality } = useHlsSource({
        videoRef,
        hlsUrl: buildFileUrl(document.hls_url),
        originalUrl: fileUrl,
        refreshHlsUrl,
    });
    const isQualityVisible = useIdleVisibility(heroRef, videoRef, isMenuOpen);

    // Same URL the dive overlay flies in (getThumbnailUrl(doc, 'lg')), so the
    // poster is pixel-identical to the overlay the FLIP settle lands on.
    const posterUrl = document.thumbnail_urls?.lg ? `${API_BASE}${document.thumbnail_urls.lg}` : undefined;
    const hasDims = Boolean(document.width && document.height);

    // Container padding mirrors ImageViewMode exactly so computeDestRect (which
    // predicts the image viewer's chrome) lands the dive on the right box.
    return (
        <div className="relative flex h-full min-h-0 w-full items-stretch justify-center overflow-hidden pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:pt-6 md:pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
                <div
                    ref={heroRef}
                    data-doc-hero
                    // aspect-locked, capped to box AND natural size (min(100%, Npx))
                    // so tall videos can't overflow (Bug: overflow) and small ones
                    // aren't upscaled — matching computeDestRect's min(..., 1) clamp
                    // so the dive settle finds a pixel-exact target (Bug: dive jump).
                    className="relative box-border flex max-h-full max-w-full items-center justify-center overflow-hidden"
                    style={
                        hasDims
                            ? {
                                  aspectRatio: `${document.width} / ${document.height}`,
                                  maxWidth: `min(100%, ${document.width}px)`,
                                  maxHeight: `min(100%, ${document.height}px)`,
                              }
                            : undefined
                    }
                >
                    <video
                        ref={videoRef}
                        src={src}
                        poster={posterUrl}
                        controls
                        controlsList="nodownload"
                        playsInline
                        preload="metadata"
                        className="h-full w-full rounded-lg object-contain shadow-2xl"
                    />
                    {levels.length > 1 && (
                        <QualityMenu
                            levels={levels}
                            selected={selected}
                            playingLabel={playingLabel}
                            visible={isQualityVisible}
                            onSelect={selectQuality}
                            onOpenChange={setIsMenuOpen}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
