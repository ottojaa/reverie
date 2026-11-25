import { FolderPickList } from '@/components/folders/FolderPickList';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { flattenTree } from '@/lib/folders/tree.js';
import { useMoveDocuments, useSections } from '@/lib/sections';
import { useState } from 'react';

interface MoveToFolderDialogProps {
    documentIds: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Move one or more documents into an existing folder. New-folder creation lives in Organize. */
export function MoveToFolderDialog({ documentIds, open, onOpenChange }: MoveToFolderDialogProps) {
    const { data: sections } = useSections();
    const moveDocuments = useMoveDocuments();
    // Undefined while nothing is picked; null is the top level.
    const [selected, setSelected] = useState<string | null>();

    const count = documentIds.length;

    const handleMove = () => {
        if (selected === undefined) return;

        moveDocuments.mutate(
            { document_ids: documentIds, folder_id: selected },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    setSelected(undefined);
                },
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Move {count === 1 ? 'document' : `${count} documents`}</DialogTitle>
                    <DialogDescription>Choose a destination folder.</DialogDescription>
                </DialogHeader>

                <div className="-mx-1 max-h-[50vh] min-h-24 overflow-y-auto px-1 py-1">
                    <FolderPickList rows={flattenTree(sections ?? [])} selected={selected} onPick={setSelected} hasTopLevel emptyText="No folders yet." />
                </div>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleMove} disabled={selected === undefined || moveDocuments.isPending}>
                        {moveDocuments.isPending ? 'Moving…' : 'Move here'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
