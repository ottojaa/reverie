import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { flattenTree } from '@/lib/folders/tree.js';
import type { FolderWithChildren } from '@reverie/shared';
import { useState, type ReactElement } from 'react';
import { FolderPickList } from './FolderPickList';

interface FolderPickPopoverProps {
    tree: FolderWithChildren[];
    /** The picked folder's id, or null for the top level. */
    selected: string | null;
    onPick: (folderId: string | null) => void;
    /** The button that opens the list. */
    children: ReactElement;
}

/** A button that opens the folder list under it: the top level, or any folder at any depth. */
export function FolderPickPopover({ tree, selected, onPick, children }: FolderPickPopoverProps) {
    const [isOpen, setIsOpen] = useState(false);

    function pick(folderId: string | null) {
        setIsOpen(false);
        onPick(folderId);
    }

    // Modal, so the list still scrolls when the button sits in a dialog or a drawer.
    return (
        <Popover modal open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-h-[min(var(--radix-popover-content-available-height),20rem)] w-(--radix-popover-trigger-width) max-w-[90vw] min-w-64 overflow-y-auto overscroll-contain p-1"
            >
                <FolderPickList rows={flattenTree(tree)} selected={selected} onPick={pick} hasTopLevel emptyText="No folders yet." />
            </PopoverContent>
        </Popover>
    );
}
