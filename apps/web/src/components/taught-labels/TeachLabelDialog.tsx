import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTaughtLabels, useTeachLabel } from '@/lib/api/taught-labels';
import { formatImageCount } from '@/lib/taught-labels';
import { Tag } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { TaughtLabelsDialog } from './TaughtLabelsDialog';

interface TeachLabelDialogProps {
    /** The images that become the label's examples (non-images are skipped by the server and reported). */
    documentIds: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after the label was taught, e.g. to clear a selection. */
    onTaught?: () => void;
}

function toErrorText(error: unknown): string {
    return error instanceof Error ? error.message : 'Couldn’t teach this label. Try again in a moment.';
}

/** Pick one of your labels or name a new one; the images you chose become its examples. */
export function TeachLabelDialog({ documentIds, open, onOpenChange, onTaught }: TeachLabelDialogProps) {
    const [name, setName] = useState('');
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const teach = useTeachLabel();
    const { data: labels = [] } = useTaughtLabels(open);
    const trimmed = name.trim();

    useEffect(() => {
        if (!open) return;

        setName('');
        teach.reset();
    }, [open]);

    function handleSubmit(event: FormEvent) {
        event.preventDefault();

        if (trimmed === '' || teach.isPending) return;

        teach.mutate(
            { name: trimmed, document_ids: documentIds },
            {
                onSuccess: ({ label, added, skipped }) => {
                    toast.success(`Teaching “${label.name}”: ${formatImageCount(added)} as examples, ${formatImageCount(label.match_count)} labelled`, {
                        description: skipped > 0 ? `${skipped} selected ${skipped === 1 ? 'item was' : 'items were'} not images and skipped.` : undefined,
                    });
                    onOpenChange(false);
                    onTaught?.();
                },
            },
        );
    }

    function openManager() {
        onOpenChange(false);
        setIsManagerOpen(true);
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>Teach a label</DialogTitle>
                            <DialogDescription>
                                {formatImageCount(documentIds.length)} selected become examples. Every image that looks like them gets the label, now and as new
                                ones arrive.
                            </DialogDescription>
                        </DialogHeader>

                        {labels.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium text-muted-foreground">Your labels</p>
                                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                                    {labels.map((label) => (
                                        <Chip key={label.id} variant="taught" title={`Add to “${label.name}”`} onClick={() => setName(label.name)}>
                                            <Tag className="size-3 shrink-0" />
                                            <span className="max-w-40 truncate">{label.name}</span>
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={60}
                            placeholder="Label name, e.g. Lunamux"
                            aria-label="Label name"
                        />

                        {teach.isError && (
                            <p role="alert" className="text-sm text-destructive">
                                {toErrorText(teach.error)}
                            </p>
                        )}

                        <DialogFooter className="sm:justify-between">
                            <Button type="button" variant="ghost" size="sm" onClick={openManager}>
                                Manage labels
                            </Button>
                            <Button type="submit" disabled={trimmed === '' || teach.isPending}>
                                {teach.isPending ? 'Teaching…' : 'Teach label'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <TaughtLabelsDialog open={isManagerOpen} onOpenChange={setIsManagerOpen} />
        </>
    );
}
