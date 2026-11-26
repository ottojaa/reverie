import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import { usePrefetchDocument } from '@/lib/hooks/usePrefetchDocument';
import type { Document } from '@reverie/shared';
import { Link } from '@tanstack/react-router';

import { DocumentActionsMenu } from './DocumentActionsMenu';
import { DocumentCardVisual } from './DocumentCardVisual';

interface DocumentCardProps {
    document: Document;
    orderedIds?: string[];
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
    className?: string;
}

export function DocumentCard({ document, orderedIds, shouldPulse, onPulseComplete, className }: DocumentCardProps) {
    const prefetchDocument = usePrefetchDocument(document);
    const interaction = useDocumentInteraction({ document, orderedIds });
    const { isSelected, isDragging, isMobile, handleClick, handleDoubleClick, dragRef, dragAttributes, gestureHandlers } = interaction;

    return (
        <DocumentActionsMenu document={document} interaction={interaction}>
            <div
                ref={dragRef}
                data-document-card
                className="relative"
                style={{ touchAction: isMobile ? 'pan-y' : 'none' }}
                {...dragAttributes}
                {...gestureHandlers}
                onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
            >
                <Link
                    to="/document/$id"
                    params={{ id: document.id }}
                    preload="intent"
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                    onMouseEnter={prefetchDocument}
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
        </DocumentActionsMenu>
    );
}
