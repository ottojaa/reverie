import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useTaughtLabels } from '@/lib/api/taught-labels';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { TaughtLabelPanel } from './TaughtLabelPanel';

interface TaughtLabelsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** The labels taught by example: each one's examples, what it currently labels, and how close an image must look. */
export function TaughtLabelsDialog({ open, onOpenChange }: TaughtLabelsDialogProps) {
    const navigate = useNavigate();
    const { data: labels = [], isLoading, isError } = useTaughtLabels(open);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = labels.find((label) => label.id === selectedId) ?? labels[0] ?? null;

    function openDocument(documentId: string) {
        onOpenChange(false);
        navigate({ to: '/document/$id', params: { id: documentId } });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[min(46rem,90vh)] flex-col gap-3 sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Taught labels</DialogTitle>
                    <DialogDescription>
                        Mark a few images with a label and every image that looks like them gets it. Matching runs on your own server; nothing is sent anywhere.
                    </DialogDescription>
                </DialogHeader>

                {isLoading && (
                    <div className="flex flex-1 items-center justify-center">
                        <Spinner />
                    </div>
                )}
                {isError && <p className="py-8 text-center text-sm text-muted-foreground">Couldn’t load your labels. Try again in a moment.</p>}
                {!isLoading && !isError && selected === null && (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                        No labels yet. Select some images and choose “Teach label…”, or open one image and use the label button in its toolbar.
                    </p>
                )}

                {selected && (
                    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                        <nav aria-label="Labels" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-y-auto md:overflow-x-visible">
                            {labels.map((label) => (
                                <Button
                                    key={label.id}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-current={label.id === selected.id}
                                    onClick={() => setSelectedId(label.id)}
                                    className={cn(
                                        'h-auto shrink-0 justify-between gap-2 py-1.5 md:w-full',
                                        label.id === selected.id && 'bg-primary/10 text-primary',
                                    )}
                                >
                                    <span className="max-w-40 truncate">{label.name}</span>
                                    <span className="text-xs tabular-nums text-muted-foreground">{label.match_count + label.example_count}</span>
                                </Button>
                            ))}
                        </nav>
                        <div className="min-h-0 overflow-y-auto pr-1">
                            <TaughtLabelPanel key={selected.id} label={selected} onOpenDocument={openDocument} onDeleted={() => setSelectedId(null)} />
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
