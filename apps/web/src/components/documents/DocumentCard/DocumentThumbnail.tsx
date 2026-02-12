import { FileTypeIcon, getFileExtension, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Play } from 'lucide-react';

export function DocumentThumbnail({ document }: { document: Document }) {
    const fileConfig = getFileTypeConfig(document.mime_type);
    const extension = getFileExtension(document.original_filename);
    const thumbnailUrl = getThumbnailUrl(document);
    const hasThumbnail = document.thumbnail_urls && document.thumbnail_status === 'complete';

    return (
        <div className="relative aspect-4/3 overflow-hidden bg-muted">
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
                    <img
                        src={thumbnailUrl}
                        alt={document.original_filename}
                        className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                    />
                    {document.mime_type.startsWith('video/') && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div className="rounded-full bg-white/90 p-3 shadow-md dark:bg-black/40">
                                <Play className="size-8 text-foreground fill-foreground" />
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className={cn('flex h-full w-full items-center justify-center', fileConfig.bgColor)}>
                    <FileTypeIcon mimeType={document.mime_type} size="xl" className="opacity-80" />
                </div>
            )}

            {extension && (
                <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white backdrop-blur-sm">
                    .{extension.toLowerCase()}
                </div>
            )}
        </div>
    );
}
