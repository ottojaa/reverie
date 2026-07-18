import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { useMoveDocuments, useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
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
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const count = documentIds.length;

    const handleMove = () => {
        if (!selectedId) return;

        moveDocuments.mutate(
            { document_ids: documentIds, folder_id: selectedId },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    setSelectedId(null);
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

                <div className="-mx-1 max-h-[50vh] min-h-24 space-y-3 overflow-y-auto px-1 py-1">
                    {(sections ?? []).map((collection) => (
                        <div key={collection.id} className="space-y-0.5">
                            <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{collection.name}</p>
                            {collection.children.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-muted-foreground/60">No folders</p>
                            ) : (
                                collection.children.map((folder) => (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => setSelectedId(folder.id)}
                                        className={cn(
                                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                            selectedId === folder.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/80',
                                        )}
                                    >
                                        <SectionIcon value={folder.emoji} className="shrink-0" />
                                        <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
                                        {selectedId === folder.id && <Check className="size-4 shrink-0 text-primary" />}
                                    </button>
                                ))
                            )}
                        </div>
                    ))}
                    {sections?.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No folders yet.</p>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleMove} disabled={!selectedId || moveDocuments.isPending}>
                        {moveDocuments.isPending ? 'Moving…' : 'Move here'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
