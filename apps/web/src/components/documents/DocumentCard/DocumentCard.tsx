import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import type { Document } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';

import { DocumentCardVisual } from './DocumentCardVisual';

interface DocumentCardProps {
    document: Document;
    orderedIds?: string[];
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
    className?: string;
}

export function DocumentCard({ document, orderedIds, shouldPulse, onPulseComplete, className }: DocumentCardProps) {
    const { isSelected, isDragging, isMobile, handleClick, handleDoubleClick, handleDelete, dragRef, dragAttributes, dragListeners, longPressHandlers } =
        useDocumentInteraction({ document, orderedIds });

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={dragRef}
                    data-document-card
                    style={{ touchAction: isMobile ? 'pan-y' : 'none' }}
                    {...dragAttributes}
                    {...dragListeners}
                    {...longPressHandlers}
                    onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
                >
                    <Link to="/document/$id" params={{ id: document.id }} onClick={handleClick} onDoubleClick={handleDoubleClick} draggable={false}>
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
                <ContextMenuItem variant="destructive" onSelect={handleDelete}>
                    <Trash2 className="size-4" />
                    Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
