import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { documentsApi } from '@/lib/api/documents';
import { buildFileUrl } from '@/lib/commonhelpers';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Lock, LockOpen, Trash2 } from 'lucide-react';

import { DocumentCardVisual } from './DocumentCardVisual';

interface DocumentCardProps {
    document: Document;
    orderedIds?: string[];
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
    className?: string;
}

export function DocumentCard({ document, orderedIds, shouldPulse, onPulseComplete, className }: DocumentCardProps) {
    const queryClient = useQueryClient();
    const {
        isSelected,
        isDragging,
        isMobile,
        isPrivate,
        handleClick,
        handleDoubleClick,
        handleDelete,
        handleTogglePrivate,
        dragRef,
        dragAttributes,
        dragListeners,
        longPressHandlers,
    } = useDocumentInteraction({ document, orderedIds });

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={dragRef}
                    data-document-card
                    className="relative"
                    style={{ touchAction: isMobile ? 'pan-y' : 'none' }}
                    {...dragAttributes}
                    {...dragListeners}
                    {...longPressHandlers}
                    onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
                >
                    {isPrivate && (
                        <div
                            className="pointer-events-none absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-accent/90 text-accent-foreground shadow-sm"
                            aria-label="Private"
                        >
                            <Lock className="size-3" />
                        </div>
                    )}
                    <Link
                        to="/document/$id"
                        params={{ id: document.id }}
                        preload="intent"
                        onClick={handleClick}
                        onDoubleClick={handleDoubleClick}
                        onMouseEnter={() => {
                            queryClient.prefetchQuery({
                                queryKey: ['document', document.id],
                                queryFn: () => documentsApi.get(document.id),
                            });

                            if (document.mime_type?.startsWith('image/') && document.file_url) {
                                const url = buildFileUrl(document.file_url);

                                if (url) new Image().src = url;
                            }
                        }}
                        draggable={false}
                    >
                        <DocumentCardVisual
                            document={document}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            shouldPulse={shouldPulse}
                            onPulseComplete={onPulseComplete}
                            className={className}
                        />
                    </Link>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onSelect={handleTogglePrivate}>
                    {isPrivate ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                    {isPrivate ? 'Remove from private' : 'Make private'}
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={handleDelete}>
                    <Trash2 className="size-4" />
                    Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
