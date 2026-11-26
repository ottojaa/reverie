import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SectionIconName } from '@/components/ui/icons-data';
import { IconSelector } from '@/components/ui/IconSelector';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateFolder } from '@/lib/sections';
import { useEffect, useState } from 'react';

const DEFAULT_SECTION_ICON: SectionIconName = 'folder';

export interface CreateSectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The folder to create it in; null or left out creates a top-level one. */
    parentId?: string | null;
    onSuccess?: () => void;
}

export function CreateSectionModal({ open, onOpenChange, parentId, onSuccess }: CreateSectionModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState<SectionIconName | null>(DEFAULT_SECTION_ICON);
    const createFolder = useCreateFolder();

    // Reset form when the modal opens
    useEffect(() => {
        if (open) {
            setName('');
            setDescription('');
            setIcon(DEFAULT_SECTION_ICON);
        }
    }, [open]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) return;

        createFolder.mutate(
            {
                name: name.trim(),
                ...(parentId && { parent_id: parentId }),
                ...(description.trim() && { description: description.trim() }),
                ...(icon && { emoji: icon }),
            },
            {
                onSuccess: () => {
                    setName('');
                    setDescription('');
                    setIcon(DEFAULT_SECTION_ICON);
                    onOpenChange(false);
                    onSuccess?.();
                },
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New folder</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-row gap-2">
                        <IconSelector value={icon} onValueChange={setIcon} />
                        <Input
                            id="create-section-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Folder name"
                            required
                            maxLength={255}
                            autoFocus
                        />
                    </div>

                    <div>
                        <label htmlFor="create-section-desc" className="mb-1.5 block text-sm font-medium">
                            Description (optional)
                        </label>
                        <Textarea
                            id="create-section-desc"
                            className="min-h-[80px]"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief description"
                            rows={3}
                        />
                    </div>

                    <DialogFooter showCloseButton>
                        <Button type="submit" disabled={!name.trim() || createFolder.isPending}>
                            {createFolder.isPending ? 'Creating…' : 'Create'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
