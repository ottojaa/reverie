import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUpdateFolder } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { useEffect, useState } from 'react';

const EMOJI_OPTIONS = ['📁', '📂', '📄', '📑', '📋', '📌', '🗂️', '📊', '📈', '🏷️', '📝', '📎', '✏️'];

export interface EditSectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    section: FolderWithChildren | null;
    onSuccess?: () => void;
}

export function EditSectionModal({ open, onOpenChange, section, onSuccess }: EditSectionModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [emoji, setEmoji] = useState<string | null>(null);
    const updateFolder = useUpdateFolder();

    useEffect(() => {
        if (section) {
            setName(section.name);
            setDescription(section.description ?? '');
            setEmoji(section.emoji ?? null);
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
                    emoji: emoji ?? null,
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
                    <DialogTitle>Edit section</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                            <button
                                type="button"
                                className={cn(
                                    'flex size-8 items-center justify-center rounded-md border text-sm transition-colors',
                                    emoji === null ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                                )}
                                onClick={() => setEmoji(null)}
                            >
                                None
                            </button>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="edit-section-name" className="mb-1.5 block text-sm font-medium">
                            Name
                        </label>
                        <Input
                            id="edit-section-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Section name"
                            required
                            maxLength={255}
                        />
                    </div>
                    <div>
                        <label htmlFor="edit-section-desc" className="mb-1.5 block text-sm font-medium">
                            Description (optional)
                        </label>
                        <textarea
                            id="edit-section-desc"
                            className="border-input min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
