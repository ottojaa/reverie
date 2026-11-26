import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MenuItems, type MenuEntry } from '@/components/ui/MenuItems';
import type { useDocumentInteraction } from '@/lib/hooks/useDocumentInteraction';
import type { Document } from '@reverie/shared';
import { Download, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { MoveToFolderDialog } from './MoveToFolderDialog';
import { RenameDialog } from './RenameDialog';

const MenuEntriesContext = createContext<MenuEntry[]>([]);

interface DocumentActionsMenuProps {
    document: Document;
    interaction: Pick<ReturnType<typeof useDocumentInteraction>, 'handleDownload' | 'handleDelete' | 'targetIds'>;
    /** Leaves right-click and long press alone, so that only a `DocumentActionsButton` inside opens the actions. */
    isButtonOnly?: boolean;
    /** The element a right-click opens the menu on. */
    children: ReactNode;
}

/** The context menu of a document card or table row, with the Rename and Move dialogs it opens. */
export function DocumentActionsMenu({ document, interaction, isButtonOnly = false, children }: DocumentActionsMenuProps) {
    const [renameOpen, setRenameOpen] = useState(false);
    // Noted when Move is chosen: a menu is outside the document list, so the click that picks an item also clears the selection.
    const [moveIds, setMoveIds] = useState<string[] | null>(null);
    const entries: MenuEntry[] = [
        { label: 'Download', icon: Download, onSelect: interaction.handleDownload },
        { label: 'Rename', icon: Pencil, onSelect: () => setRenameOpen(true) },
        { label: 'Move to…', icon: FolderInput, onSelect: () => setMoveIds(interaction.targetIds) },
        { label: 'Delete', icon: Trash2, onSelect: interaction.handleDelete, isDestructive: true },
    ];

    return (
        <MenuEntriesContext.Provider value={entries}>
            <ContextMenu>
                <ContextMenuTrigger asChild disabled={isButtonOnly}>
                    {children}
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <MenuItems entries={entries} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
                </ContextMenuContent>
            </ContextMenu>

            {renameOpen && <RenameDialog document={document} open={renameOpen} onOpenChange={setRenameOpen} />}
            {moveIds && <MoveToFolderDialog documentIds={moveIds} open onOpenChange={(open) => !open && setMoveIds(null)} />}
        </MenuEntriesContext.Provider>
    );
}

/** A "…" button opening the actions of the surrounding `DocumentActionsMenu` as a dropdown. */
export function DocumentActionsButton({ className }: { className?: string }) {
    const entries = useContext(MenuEntriesContext);
    const [isOpen, setIsOpen] = useState(false);

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={className}
                    aria-label="Document actions"
                    // A dropdown opens on pointer down, which would also catch a swipe that scrolls from here. A click opens this one.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setIsOpen(true)}
                >
                    <MoreHorizontal />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <MenuItems entries={entries} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
