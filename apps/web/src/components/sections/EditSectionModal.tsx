import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SectionIconName } from '@/components/ui/icons-data';
import { IconSelector } from '@/components/ui/IconSelector';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateFolder } from '@/lib/sections';
import type { FolderWithChildren } from '@reverie/shared';
import { dynamicIconImports } from 'lucide-react/dynamic';
import { useEffect, useState } from 'react';

function toSectionIconName(emoji: string | null): SectionIconName | null {
    if (emoji == null || emoji === '') return null;

    return emoji in dynamicIconImports ? (emoji as SectionIconName) : null;
}

export interface EditSectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    section: FolderWithChildren | null;
    onSuccess?: () => void;
}

export function EditSectionModal({ open, onOpenChange, section, onSuccess }: EditSectionModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState<SectionIconName | null>(null);
    const updateFolder = useUpdateFolder();

    useEffect(() => {
        if (section) {
            setName(section.name);
            setDescription(section.description ?? '');
            setIcon(toSectionIconName(section.emoji ?? null));
        }
    }, [section]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!section || !name.trim()) return;

        updateFolder.mutate(
            {
                id: section.id,
                data: {
                    name: name.trim(),
                    description: description.trim() || null,
                    emoji: icon ?? null,
                },
            },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    onSuccess?.();
                },
            },
        );
    };

    if (!section) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit folder</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-row gap-2">
                        <IconSelector value={icon} onValueChange={setIcon} />
                        <Input
                            id="edit-section-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Folder name"
                            required
                            maxLength={255}
                        />
                    </div>
                    <div>
                        <label htmlFor="edit-section-desc" className="mb-1.5 block text-sm font-medium">
                            Description (optional)
                        </label>
                        <Textarea
                            id="edit-section-desc"
                            className="min-h-[80px]"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief description"
                            rows={3}
                        />
                    </div>
                    <DialogFooter showCloseButton>
                        <Button type="submit" disabled={!name.trim() || updateFolder.isPending}>
                            {updateFolder.isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
