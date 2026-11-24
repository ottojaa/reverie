import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { fileTypeLabel } from '@/lib/browse/file-type-label';
import { formatAddedDate } from '@/lib/browse/format-added';
import { formatFileSize } from '@/lib/commonhelpers';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';

import { DocumentActionsMenu } from './DocumentCard/DocumentActionsMenu';
import { RowThumb } from './RowThumb';

interface DocumentRowProps {
    document: Document;
    orderedIds: string[];
    /** Grid template shared with the table header, so the columns line up. */
    columns: string;
    /** The folder's name, or null for no Folder column. */
    folderName: string | null | undefined;
    style: React.CSSProperties;
    /**
     * `badge` (the Files table) shows the extension on its tint; `thumbnail` (Recently added) shows the picture in a larger
     * box, behind a gap where a group row has its chevron so the pictures of all rows line up.
     */
    leading?: 'badge' | 'thumbnail';
    /** A member of an expanded group: set in from the edge, on a darker band. */
    member?: boolean;
}

/** One row of the Files table. Selects, drags and opens like a card in the grid, with the same context menu. */
export const DocumentRow = memo(function DocumentRow({
    document,
    orderedIds,
    columns,
    folderName,
    style,
    leading = 'badge',
    member = false,
}: DocumentRowProps) {
    const interaction = useDocumentInteraction({ document, orderedIds });
    const { isSelected, isDragging, isMobile, handleClick, handleDoubleClick, dragRef, dragAttributes, dragListeners, longPressHandlers } = interaction;
    const config = getFileTypeConfig(document.mime_type, document.original_filename);
    const label = fileTypeLabel(document.mime_type, document.original_filename);
    const showFolder = folderName !== undefined;

    return (
        <DocumentActionsMenu document={document} interaction={interaction}>
            <div
                ref={dragRef}
                data-document-card
                className={cn('absolute left-0 right-0', isDragging && 'opacity-50')}
                style={{ ...style, touchAction: isMobile ? 'pan-y' : 'none' }}
                {...dragAttributes}
                {...dragListeners}
                {...longPressHandlers}
                onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
            >
                <Link
                    to="/document/$id"
                    params={{ id: document.id }}
                    preload="intent"
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                    draggable={false}
                    className={cn(
                        'grid h-full items-center gap-4 border-t border-border/60 px-4 text-sm transition-colors hover:bg-muted/50',
                        member && 'bg-background/50 pl-6',
                        'focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                        isSelected && 'bg-primary/12 hover:bg-primary/15 dark:bg-primary/15',
                    )}
                    style={{ gridTemplateColumns: columns }}
                >
                    <span className="flex min-w-0 items-center gap-3">
                        {leading === 'thumbnail' ? (
                            <>
                                <span className="w-3.5 shrink-0" aria-hidden />
                                <span className="size-9 shrink-0">
                                    <RowThumb document={document} />
                                </span>
                            </>
                        ) : (
                            <span
                                className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold uppercase',
                                    config.bgColor,
                                    config.color,
                                )}
                                aria-hidden
                            >
                                {label}
                            </span>
                        )}
                        <span className="truncate font-medium" title={document.original_filename}>
                            {document.original_filename}
                        </span>
                    </span>
                    {showFolder && <span className="truncate text-muted-foreground">{folderName ?? '—'}</span>}
                    <span className="text-right font-mono text-[13px] text-muted-foreground">{formatFileSize(document.size_bytes)}</span>
                    <span className="truncate text-muted-foreground">{formatAddedDate(document.created_at)}</span>
                </Link>
            </div>
        </DocumentActionsMenu>
    );
});
