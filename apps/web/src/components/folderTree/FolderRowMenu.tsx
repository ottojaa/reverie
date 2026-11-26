import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { isInheritedPrivate } from '@/lib/folders/privacy.js';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { FolderPlus, Lock, LockOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Fragment, type ComponentProps, type ComponentType, type ReactNode } from 'react';

export interface FolderRowActions {
    onNewFolder: (parentId: string) => void;
    onEdit: (folder: FolderWithChildren) => void;
    onTogglePrivate: (folder: FolderWithChildren) => void;
    onDelete: (folder: FolderWithChildren) => void;
}

interface MenuEntry {
    label: string;
    icon: typeof Pencil;
    onSelect?: () => void;
    isDestructive?: boolean;
}

function toPrivateEntry(folder: FolderWithChildren, actions: FolderRowActions): MenuEntry {
    // A folder inside a private one cannot be made public on its own.
    if (isInheritedPrivate(folder)) return { label: 'Private (inherited)', icon: Lock };

    const onSelect = () => actions.onTogglePrivate(folder);

    return folder.is_private ? { label: 'Remove from private', icon: LockOpen, onSelect } : { label: 'Make private', icon: Lock, onSelect };
}

/** The row's actions, with the destructive one last. A locked folder cannot be added into. */
function toMenuEntries(folder: FolderWithChildren, actions: FolderRowActions): MenuEntry[] {
    const newFolder = { label: 'New folder inside', icon: FolderPlus, onSelect: () => actions.onNewFolder(folder.id) };

    return [
        ...(folder.locked ? [] : [newFolder]),
        { label: 'Edit', icon: Pencil, onSelect: () => actions.onEdit(folder) },
        toPrivateEntry(folder, actions),
        { label: 'Delete', icon: Trash2, onSelect: () => actions.onDelete(folder), isDestructive: true },
    ];
}

/** The parts a context menu and a dropdown menu share. */
interface MenuParts {
    Item: ComponentType<{ variant?: 'default' | 'destructive'; disabled?: boolean; onSelect?: () => void; children: ReactNode }>;
    Separator: ComponentType;
}

function MenuItems({ entries, Item, Separator }: MenuParts & { entries: MenuEntry[] }) {
    return entries.map(({ label, icon: Icon, onSelect, isDestructive }) => (
        <Fragment key={label}>
            {isDestructive && <Separator />}
            <Item variant={isDestructive ? 'destructive' : 'default'} disabled={!onSelect} {...(onSelect && { onSelect })}>
                <Icon className="size-4" />
                {label}
            </Item>
        </Fragment>
    ));
}

function ActionsButton({ className, ...props }: ComponentProps<typeof Button>) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('size-auto shrink-0 rounded p-0.5 hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent', className)}
            aria-label="Folder actions"
            {...props}
        >
            <MoreHorizontal className="size-4" />
        </Button>
    );
}

/** The "…" button of a touch screen, opening the row's actions as a dropdown. */
export function FolderActionsDropdown({ folder, actions }: { folder: FolderWithChildren; actions: FolderRowActions }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ActionsButton />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <MenuItems entries={toMenuEntries(folder, actions)} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** The "…" button shown on hover, which opens the row's context menu where it was clicked. */
export function FolderActionsHoverButton() {
    return (
        <ActionsButton
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const { x, y, width, height } = e.currentTarget.getBoundingClientRect();
                // A keyboard "click" has no pointer position, so the menu opens on the button.
                const position = e.detail === 0 ? { clientX: x + width / 2, clientY: y + height / 2 } : { clientX: e.clientX, clientY: e.clientY };
                e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...position }));
            }}
        />
    );
}

/** Right-click menu around a row. */
export function FolderContextMenu({ folder, actions, children }: { folder: FolderWithChildren; actions: FolderRowActions; children: ReactNode }) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                <MenuItems entries={toMenuEntries(folder, actions)} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
            </ContextMenuContent>
        </ContextMenu>
    );
}
