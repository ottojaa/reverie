import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { documentsApi } from '@/lib/api/documents';
import { buildFileUrl } from '@/lib/commonhelpers';
import { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, FolderInput, Lock, LockOpen, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { DocumentCardVisual } from './DocumentCardVisual';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { RenameDialog } from './RenameDialog';

interface DocumentCardProps {
    document: Document;
    orderedIds?: string[];
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
    className?: string;
}

export function DocumentCard({ document, orderedIds, shouldPulse, onPulseComplete, className }: DocumentCardProps) {
    const queryClient = useQueryClient();
    const [renameOpen, setRenameOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const {
        isSelected,
        isDragging,
        isMobile,
        isPrivate,
        isLocked,
        handleClick,
        handleDoubleClick,
        handleOpen,
        handleDelete,
        handleTogglePrivate,
        handleDownload,
        targetIds,
        dragRef,
        dragAttributes,
        dragListeners,
        longPressHandlers,
    } = useDocumentInteraction({ document, orderedIds });

    return (
        <>
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
                        {isLocked ? (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpen();
                                }}
                                className="absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-accent/90 text-accent-foreground shadow-sm transition-transform hover:scale-110"
                                aria-label="Locked — click to unlock"
                                title="Locked — click to unlock"
                            >
                                <Lock className="size-3" />
                            </button>
                        ) : (
                            isPrivate && (
                                <div
                                    className="pointer-events-none absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-accent/90 text-accent-foreground shadow-sm"
                                    aria-label="Private"
                                >
                                    <Lock className="size-3" />
                                </div>
                            )
                        )}
                        <Link
                            to="/document/$id"
                            params={{ id: document.id }}
                            preload="intent"
                            onClick={handleClick}
                            onDoubleClick={handleDoubleClick}
                            onMouseEnter={() => {
                                // Nothing to warm for a locked document (content is withheld).
                                if (isLocked) return;

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
                    <ContextMenuItem onSelect={handleDownload}>
                        <Download className="size-4" />
                        Download
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setRenameOpen(true)}>
                        <Pencil className="size-4" />
                        Rename
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setMoveOpen(true)}>
                        <FolderInput className="size-4" />
                        Move to…
                    </ContextMenuItem>
                    <ContextMenuSeparator />
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

            {renameOpen && <RenameDialog document={document} open={renameOpen} onOpenChange={setRenameOpen} />}
            {moveOpen && <MoveToFolderDialog documentIds={targetIds} open={moveOpen} onOpenChange={setMoveOpen} />}
        </>
    );
}
