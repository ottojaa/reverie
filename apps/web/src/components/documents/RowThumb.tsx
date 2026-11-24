import { getFileExtension, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';

type ThumbDocument = Pick<Document, 'mime_type' | 'original_filename' | 'thumbnail_urls' | 'thumbnail_status'>;

interface RowThumbProps {
    document: ThumbDocument;
    className?: string;
    /** Write the extension on a tile that has no picture. Off for the tiles behind the front one of a pile, which would only print over each other. */
    label?: boolean;
}

/** A table row's picture: the document's thumbnail, or its extension on the file-type tint when it has none. */
export function RowThumb({ document, className, label = true }: RowThumbProps) {
    const url = document.thumbnail_status === 'complete' ? getThumbnailUrl(document, 'sm') : null;
    const config = getFileTypeConfig(document.mime_type, document.original_filename);
    const extension = getFileExtension(document.original_filename).slice(0, 4);

    if (url) return <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className={cn('size-full rounded-lg object-cover', className)} />;

    return (
        <span
            className={cn(
                'flex size-full items-center justify-center rounded-lg font-mono text-[10px] font-semibold uppercase',
                config.bgColor,
                config.color,
                className,
            )}
            aria-hidden
        >
            {label && (extension || 'FILE')}
        </span>
    );
}

/** Where each tile of a pile sits, by how many tiles there are: the oldest behind, up and to the right. */
function pileOffset(index: number, count: number): { left: number; top: number } {
    const step = (count - 1 - index) * 4;

    return { left: step, top: 4 - step };
}

const PILE_TILES = 3;

/** The picture of a group row: up to three of its members' pictures stacked, the newest in front. */
export function PileThumb({ documents }: { documents: ThumbDocument[] }) {
    // Newest first in `documents`; the pile paints the oldest first so the newest ends up on top.
    const tiles = documents.slice(0, PILE_TILES).reverse();

    return (
        <span className="relative block size-9 shrink-0" aria-hidden>
            {tiles.map((document, index) => (
                <span key={index} className="absolute block size-8 overflow-hidden rounded-lg ring-2 ring-card" style={pileOffset(index, tiles.length)}>
                    <RowThumb document={document} label={index === tiles.length - 1} />
                </span>
            ))}
        </span>
    );
}
