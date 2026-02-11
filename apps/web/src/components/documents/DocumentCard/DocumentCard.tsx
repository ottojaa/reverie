import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

import { DocumentInfoFooter } from './DocumentInfoFooter';
import { DocumentThumbnail } from './DocumentThumbnail';
import { PulseOverlay } from './PulseOverlay';

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
                <div ref={dragRef} data-document-card style={{ touchAction: 'none' }} {...dragAttributes} {...dragListeners} {...longPressHandlers} onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}>
                    <Link to="/document/$id" params={{ id: document.id }} onClick={handleClick} onDoubleClick={handleDoubleClick} draggable={false}>
                        <div className="relative">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: isDragging ? 0.5 : 1, scale: isDragging ? 0.98 : 1 }}
                                whileHover={isDragging ? {} : { scale: 1.02, y: -2 }}
                                transition={{ duration: 0.2 }}
                                className={cn(
                                    'group relative overflow-hidden rounded-md bg-card transition-shadow',
                                    'border border-border/50 shadow-md hover:shadow-lg',
                                    'dark:border-border dark:shadow-none dark:hover:shadow-none',
                                    isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background dark:ring-offset-background',
                                    isDragging && 'cursor-grabbing',
                                    className,
                                )}
                            >
                                {isSelected && <div className="z-10 pointer-events-none absolute inset-0 rounded-md bg-primary/12 dark:bg-primary/15" aria-hidden />}

                                <DocumentThumbnail document={document} />
                                <DocumentInfoFooter document={document} />
                            </motion.div>

                            <PulseOverlay active={shouldPulse} onComplete={onPulseComplete} />
                        </div>
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
