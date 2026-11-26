import { FolderPickPopover } from '@/components/folders/FolderPickPopover';
import { Button } from '@/components/ui/button';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { findFolder } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import { ChevronDown, FolderX } from 'lucide-react';

interface UploadDestinationMenuProps {
    /** Where the files go: a folder's id, or null for the top level. */
    folderId: string | null;
    onPick: (folderId: string | null) => void;
}

/** "To folder:" in the upload dialog. */
export function UploadDestinationMenu({ folderId, onPick }: UploadDestinationMenuProps) {
    const { data: tree = [] } = useSections();
    const selected = findFolder(tree, folderId);
    // A folder the tree does not list (still loading, or inside a locked one) is still where the files go.
    const label = selected?.name ?? (folderId ? 'Current folder' : 'No folder (top level)');

    return (
        <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">To folder:</span>
            <FolderPickPopover tree={tree} selected={folderId} onPick={onPick}>
                <Button type="button" variant="outline" size="sm" className="min-w-0 shrink gap-1.5">
                    {folderId ? <SectionIcon value={selected?.emoji || 'folder'} /> : <FolderX className="size-4" />}
                    <span className="truncate">{label}</span>
                    <ChevronDown className="size-4" />
                </Button>
            </FolderPickPopover>
        </div>
    );
}
