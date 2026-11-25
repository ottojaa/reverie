import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { findFolder, flattenTree, toIndent } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import { useVault } from '@/lib/vault';
import type { FolderWithChildren } from '@reverie/shared';
import { ChevronDown, FolderX, Lock } from 'lucide-react';

interface UploadDestinationMenuProps {
    /** Where the files go: a folder's id, or null for the top level. */
    folderId: string | null;
    onPick: (folderId: string | null) => void;
}

/** "To folder:" in the upload dialog: the top level, or any folder at any depth. */
export function UploadDestinationMenu({ folderId, onPick }: UploadDestinationMenuProps) {
    const { data: tree = [] } = useSections();
    const { requestUnlock } = useVault();
    const selected = findFolder(tree, folderId);
    // A folder the tree does not list (still loading, or inside a locked one) is still where the files go.
    const label = selected?.name ?? (folderId ? 'Current folder' : 'No folder (top level)');

    async function pickFolder(folder: FolderWithChildren) {
        if (folder.locked && !(await requestUnlock(folder.id))) return;

        onPick(folder.id);
    }

    return (
        <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">To folder:</span>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-0 shrink gap-1.5">
                        {folderId ? <SectionIcon value={selected?.emoji || 'folder'} /> : <FolderX className="size-4" />}
                        <span className="truncate">{label}</span>
                        <ChevronDown className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-[min(50vh,20rem)] max-w-[min(90vw,24rem)] overflow-y-auto">
                    <DropdownMenuItem onSelect={() => onPick(null)}>
                        <FolderX />
                        No folder (top level)
                    </DropdownMenuItem>
                    {flattenTree(tree).map(({ folder, depth }) => (
                        <DropdownMenuItem key={folder.id} style={{ paddingLeft: toIndent(depth) }} onSelect={() => void pickFolder(folder)}>
                            <SectionIcon value={folder.emoji || 'folder'} />
                            <span className="min-w-0 truncate">{folder.name}</span>
                            {folder.locked && <Lock className="ml-auto" aria-label="Locked" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
