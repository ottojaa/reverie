import { Button } from '@/components/ui/button';
import { ImageLoader } from '@/components/ui/image-loader';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { formatDate, getThumbnailUrl } from '@/lib/commonhelpers';
import type { DocumentSearchResult, SearchHit } from '@reverie/shared';
import { FileText, Folder, Image, Receipt } from 'lucide-react';
import { memo, useRef } from 'react';

interface PhotoResultGridProps {
    results: SearchHit[];
    onOpenDocument: (id: string) => void;
    onOpenCollection: (id: string) => void;
}

const categoryIcons: Record<string, typeof FileText> = {
    photo: Image,
    screenshot: Image,
    graphic: Image,
    receipt: Receipt,
    invoice: Receipt,
};

function getDocIcon(result: DocumentSearchResult): typeof FileText {
    const byCategory = result.category ? categoryIcons[result.category] : undefined;

    if (byCategory) return byCategory;

    if (result.mime_type.startsWith('image/')) return Image;

    return FileText;
}

const tileClass = 'group relative aspect-square h-auto w-full overflow-hidden rounded-lg bg-muted p-0 focus-visible:ring-2 focus-visible:ring-ring/50';

function DocumentTile({ result, onOpen }: { result: DocumentSearchResult; onOpen: (id: string) => void }) {
    const thumbRef = useRef<HTMLDivElement>(null);
    const thumbnailUrl = getThumbnailUrl(result, 'lg');
    const date = result.extracted_date ?? result.uploaded_at;

    if (!thumbnailUrl) {
        const Icon = getDocIcon(result);

        return (
            <Button type="button" variant="ghost" onClick={() => onOpen(result.document_id)} className={tileClass}>
                <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-2">
                    <Icon className="size-8 text-muted-foreground/60" />
                </span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-background/70 p-2 text-left text-xs text-foreground backdrop-blur-sm">
                    {result.display_name}
                </span>
            </Button>
        );
    }

    return (
        <Button type="button" variant="ghost" onClick={() => onOpen(result.document_id)} className={tileClass} title={result.display_name}>
            <ImageLoader ref={thumbRef} hash={result.blurhash ?? ''} url={thumbnailUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* Name/date scrim on hover & keyboard focus */}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-0.5 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="w-full truncate text-left text-xs font-medium text-white">{result.display_name}</span>
                <span className="text-[10px] tabular-nums text-white/70">{formatDate(date)}</span>
            </span>
        </Button>
    );
}

/** Thumbnail-first grid for photo-heavy result sets. Non-image documents keep a labeled icon tile. */
export const PhotoResultGrid = memo(function PhotoResultGrid({ results, onOpenDocument, onOpenCollection }: PhotoResultGridProps) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {results.map((result) => {
                if (result.result_type === 'collection') {
                    return (
                        <Button key={`col-${result.id}`} type="button" variant="ghost" onClick={() => onOpenCollection(result.id)} className={tileClass}>
                            <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-3xl">
                                {/* emoji can hold a lucide icon slug — SectionIcon resolves it */}
                                {result.emoji ? (
                                    <SectionIcon value={result.emoji} className="size-8 text-3xl text-muted-foreground/60" />
                                ) : (
                                    <Folder className="size-8 text-muted-foreground/60" />
                                )}
                            </span>
                            <span className="absolute inset-x-0 bottom-0 truncate bg-background/70 p-2 text-left text-xs text-foreground backdrop-blur-sm">
                                {result.name}
                            </span>
                        </Button>
                    );
                }

                return <DocumentTile key={`doc-${result.document_id}`} result={result} onOpen={onOpenDocument} />;
            })}
        </div>
    );
});
