import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCreateFolder } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const EMOJI_OPTIONS = ['📁', '📂', '📄', '📑', '📋', '📌', '📎', '🗂️', '📊', '📈', '🏷️', '📝', '📎', '✏️', '📌'];

export type CreateFolderMode = 'category' | 'section';

export interface CreateSectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentId?: string | null;
    mode?: CreateFolderMode;
    onSuccess?: () => void;
}

export function CreateSectionModal({ open, onOpenChange, parentId, mode = 'section', onSuccess }: CreateSectionModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [emoji, setEmoji] = useState<string | null>(mode === 'category' ? null : '📁');
    const createFolder = useCreateFolder();

    // Reset form when modal opens or mode changes
    useEffect(() => {
        if (open) {
            setName('');
            setDescription('');
            setEmoji(mode === 'category' ? null : '📁');
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
                ...(emoji && { emoji }),
            },
            {
                onSuccess: () => {
                    setName('');
                    setDescription('');
                    setEmoji(isCategory ? null : '📁');
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
                            <label className="mb-1.5 block text-sm font-medium">Emoji (optional)</label>
                            <div className="flex flex-wrap gap-1.5">
                                {EMOJI_OPTIONS.map((e) => (
                                    <button
                                        key={e}
                                        type="button"
                                        className={cn(
                                            'flex size-8 items-center justify-center rounded-md border text-lg transition-colors',
                                            emoji === e ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                                        )}
                                        onClick={() => setEmoji(e)}
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
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
                            <textarea
                                id="create-section-desc"
                                className="border-input min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
