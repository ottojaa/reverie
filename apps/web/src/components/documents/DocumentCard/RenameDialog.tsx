import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUpdateDocument } from '@/lib/api';
import type { Document } from '@reverie/shared';
import { useState } from 'react';

interface RenameDialogProps {
    document: Document;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Rename a single document's display filename (metadata only — storage is content-addressed). */
export function RenameDialog({ document, open, onOpenChange }: RenameDialogProps) {
    const updateDocument = useUpdateDocument();
    const [name, setName] = useState(document.original_filename);

    const trimmed = name.trim();
    const unchanged = trimmed === document.original_filename;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!trimmed || unchanged) {
            onOpenChange(false);

            return;
        }

        updateDocument.mutate({ documentId: document.id, original_filename: trimmed }, { onSuccess: () => onOpenChange(false) });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>Rename document</DialogTitle>
                    </DialogHeader>
                    <Input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        maxLength={255}
                        aria-label="File name"
                    />
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!trimmed || updateDocument.isPending}>
                            {updateDocument.isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
