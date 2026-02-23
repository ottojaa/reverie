import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SectionIconName } from '@/components/ui/icons-data';
import { IconSelector } from '@/components/ui/IconSelector';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateFolder } from '@/lib/sections';
import { useEffect, useState } from 'react';
import type { FolderMode } from './folder-mode.js';

const DEFAULT_SECTION_ICON: SectionIconName = 'folder';

export interface CreateSectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentId?: string | null;
    mode?: FolderMode;
    onSuccess?: () => void;
}

export function CreateSectionModal({ open, onOpenChange, parentId, mode = 'section', onSuccess }: CreateSectionModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState<SectionIconName | null>(mode === 'category' ? null : DEFAULT_SECTION_ICON);
    const createFolder = useCreateFolder();

    // Reset form when modal opens or mode changes
    useEffect(() => {
        if (open) {
            setName('');
            setDescription('');
            setIcon(mode === 'category' ? null : DEFAULT_SECTION_ICON);
        }
    }, [open, mode]);

    const isCategory = mode === 'category';
    const isSection = mode === 'section';
    const title = isCategory ? 'New category' : parentId ? 'New section' : 'New section';
    const namePlaceholder = isCategory ? 'Category name' : 'Section name';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) return;

        createFolder.mutate(
            {
                name: name.trim(),
                ...(isCategory ? { type: 'category' as const } : { type: 'section' as const }),
                ...(parentId && { parent_id: parentId }),
                ...(description.trim() && { description: description.trim() }),
                ...(icon && { emoji: icon }),
            },
            {
                onSuccess: () => {
                    setName('');
                    setDescription('');
                    setIcon(isCategory ? null : DEFAULT_SECTION_ICON);
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
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {isSection && (
                        <div>
                            <label className="mb-1.5 block text-sm font-medium">Icon (optional)</label>
                            <IconSelector value={icon} onValueChange={setIcon} />
                        </div>
                    )}
                    <div>
                        <label htmlFor="create-section-name" className="mb-1.5 block text-sm font-medium">
                            Name
                        </label>
                        <Input
                            id="create-section-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={namePlaceholder}
                            required
                            maxLength={255}
                            autoFocus
                        />
                    </div>

                    {isSection && (
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
                    )}

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
