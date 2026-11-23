import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import type { Document } from '@reverie/shared';
import { Download, FolderInput, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { MoveToFolderDialog } from './MoveToFolderDialog';
import { RenameDialog } from './RenameDialog';

interface DocumentActionsMenuProps {
    document: Document;
    interaction: Pick<ReturnType<typeof useDocumentInteraction>, 'handleDownload' | 'handleDelete' | 'targetIds'>;
    /** The element a right-click opens the menu on. */
    children: ReactNode;
}

/** The context menu of a document card or table row, with the Rename and Move dialogs it opens. */
export function DocumentActionsMenu({ document, interaction, children }: DocumentActionsMenuProps) {
    const [renameOpen, setRenameOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={interaction.handleDownload}>
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
                    <ContextMenuItem variant="destructive" onSelect={interaction.handleDelete}>
                        <Trash2 className="size-4" />
                        Delete
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {renameOpen && <RenameDialog document={document} open={renameOpen} onOpenChange={setRenameOpen} />}
            {moveOpen && <MoveToFolderDialog documentIds={interaction.targetIds} open={moveOpen} onOpenChange={setMoveOpen} />}
        </>
    );
}
