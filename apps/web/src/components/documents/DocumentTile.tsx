import { documentsApi } from '@/lib/api/documents';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { DocumentActionsMenu } from './DocumentCard/DocumentActionsMenu';
import { DocumentThumbnail } from './DocumentCard/DocumentThumbnail';
import { PulseOverlay } from './DocumentCard/PulseOverlay';

interface DocumentTileProps {
    document: Document;
    orderedIds: string[];
    width: number;
    height: number;
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
}

/**
 * A picture with nothing under it, for the Grid and Justified layouts. It selects, drags, opens and has the context
 * menu exactly like a card (same interaction hook and actions menu); a video keeps its duration badge.
 */
export const DocumentTile = memo(function DocumentTile({ document, orderedIds, width, height, shouldPulse, onPulseComplete }: DocumentTileProps) {
    const queryClient = useQueryClient();
    const interaction = useDocumentInteraction({ document, orderedIds });
    const { isSelected, isDragging, isMobile, handleClick, handleDoubleClick, dragRef, dragAttributes, dragListeners, longPressHandlers } = interaction;

    return (
        <DocumentActionsMenu document={document} interaction={interaction}>
            <div
                ref={dragRef}
                data-document-card
                className="relative shrink-0"
                style={{ width, height, touchAction: isMobile ? 'pan-y' : 'none' }}
                {...dragAttributes}
                {...dragListeners}
                {...longPressHandlers}
                onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
            >
                <Link
                    to="/document/$id"
                    params={{ id: document.id }}
                    aria-label={document.original_filename}
                    title={document.original_filename}
                    preload="intent"
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                    onMouseEnter={() => {
                        queryClient.prefetchQuery({ queryKey: ['document', document.id], queryFn: () => documentsApi.get(document.id) });
                    }}
                    draggable={false}
                    className={cn(
                        'block h-full w-full overflow-hidden rounded-sm transition-opacity',
                        isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                        isDragging && 'cursor-grabbing opacity-50',
                    )}
                >
                    <DocumentThumbnail document={document} variant="tile" />
                    {isSelected && <div className="pointer-events-none absolute inset-0 rounded-sm bg-primary/15" aria-hidden />}
                </Link>
                {shouldPulse && <PulseOverlay onComplete={onPulseComplete} />}
            </div>
        </DocumentActionsMenu>
    );
});
