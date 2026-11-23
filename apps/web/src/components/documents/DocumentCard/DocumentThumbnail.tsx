import { formatDuration } from '@/components/document-viewer/insights/media-facts';
import { FileTypeIcon, getFileExtension, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { ImageLoader } from '@/components/ui/image-loader';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { documentKindOf, type Document } from '@reverie/shared';
import { Play } from 'lucide-react';
import { memo, useRef } from 'react';

interface DocumentThumbnailProps {
    document: Document;
    /** `card` is the 4:3 picture above a footer; `tile` fills whatever box it is in, with no play button or extension badge. */
    variant?: 'card' | 'tile';
}

export const DocumentThumbnail = memo(function DocumentThumbnail({ document, variant = 'card' }: DocumentThumbnailProps) {
    const isTile = variant === 'tile';
    const thumbnailRef = useRef<HTMLDivElement>(null);
    const fileConfig = getFileTypeConfig(document.mime_type, document.original_filename);
    const extension = getFileExtension(document.original_filename);
    const thumbnailUrl = getThumbnailUrl(document, 'lg');
    const isVideo = documentKindOf(document.mime_type) === 'video';
    const hasThumbnail = document.thumbnail_urls && document.thumbnail_status === 'complete';

    return (
        <div className={cn('relative overflow-hidden bg-muted', isTile ? 'h-full w-full' : 'aspect-4/3')}>
            {hasThumbnail && thumbnailUrl ? (
                <>
                    {document.thumbnail_blurhash && (
                        <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{
                                background: `linear-gradient(135deg, ${fileConfig.bgColor}, ${fileConfig.bgColor})`,
                            }}
                        />
                    )}
                    <div className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105">
                        <ImageLoader
                            ref={thumbnailRef}
                            hash={document.thumbnail_blurhash ?? ''}
                            url={thumbnailUrl}
                            style={{ objectFit: 'cover', height: '100%', width: '100%' }}
                        />
                    </div>

                    {!isTile && isVideo && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div className="rounded-full bg-white/90 p-3 shadow-md dark:bg-black/40">
                                <Play className="size-8 text-foreground fill-foreground" />
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className={cn('flex h-full w-full items-center justify-center', fileConfig.bgColor)}>
                    <FileTypeIcon mimeType={document.mime_type} filename={document.original_filename} size="xl" className="opacity-80" />
                </div>
            )}

            {isVideo && document.duration_seconds != null && (
                <div className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur-sm">
                    {formatDuration(document.duration_seconds)}
                </div>
            )}

            {!isTile && extension && (
                <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white backdrop-blur-sm">
                    .{extension.toLowerCase()}
                </div>
            )}
        </div>
    );
});
