import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useDeleteLabel, useRemoveLabelExample, useRemoveLabelMatch, useTaughtLabel } from '@/lib/api/taught-labels';
import { useConfirm } from '@/lib/confirm';
import type { DocumentSearchResult, TaughtLabel } from '@reverie/shared';
import { Trash2 } from 'lucide-react';
import { LabelThumbnails } from './LabelThumbnails';
import { ThresholdControl } from './ThresholdControl';

interface TaughtLabelPanelProps {
    label: TaughtLabel;
    onOpenDocument: (documentId: string) => void;
    onDeleted: () => void;
}

/** One label: its threshold, the example images and the images it currently labels. */
export function TaughtLabelPanel({ label, onOpenDocument, onDeleted }: TaughtLabelPanelProps) {
    const confirm = useConfirm();
    const { data, isLoading, isError } = useTaughtLabel(label.id);
    const removeExample = useRemoveLabelExample();
    const removeMatch = useRemoveLabelMatch();
    const deleteLabel = useDeleteLabel();
    const isBusy = removeExample.isPending || removeMatch.isPending || deleteLabel.isPending;

    async function handleDelete() {
        const confirmed = await confirm({
            title: `Delete the label “${label.name}”?`,
            description: 'Its tag is taken off every image it was put on automatically. Tags you added yourself stay.',
            confirmText: 'Delete label',
            cancelText: 'Cancel',
            variant: 'destructive',
        });

        if (!confirmed) return;

        deleteLabel.mutate(label.id, { onSuccess: onDeleted });
    }

    return (
        <div className="min-w-0 space-y-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold" title={label.name}>
                        {label.name}
                    </h2>
                    <p className="text-xs text-muted-foreground">Searchable as tag:{label.name}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleDelete} disabled={isBusy} className="shrink-0">
                    <Trash2 className="size-4" />
                    Delete
                </Button>
            </div>

            <ThresholdControl key={label.id + label.threshold} label={label} />

            {isLoading && (
                <div className="flex justify-center py-8">
                    <Spinner />
                </div>
            )}
            {isError && <p className="py-4 text-sm text-muted-foreground">Couldn’t load this label. Try again in a moment.</p>}

            {data && (
                <>
                    <LabelThumbnails
                        title="Examples"
                        description="Images you taught it with. Matches are measured against these."
                        documents={data.examples}
                        emptyText="No visible examples."
                        removeLabel={(doc: DocumentSearchResult) => `Remove ${doc.display_name} as an example`}
                        onRemove={(doc) => removeExample.mutate({ id: label.id, documentId: doc.document_id })}
                        onOpen={(doc) => onOpenDocument(doc.document_id)}
                        disabled={isBusy}
                    />
                    <LabelThumbnails
                        title="Matches"
                        description="Removing one keeps this label off that image for good."
                        documents={data.matches}
                        total={data.match_total}
                        emptyText="Nothing else looks like the examples at this threshold."
                        removeLabel={(doc: DocumentSearchResult) => `Remove the label from ${doc.display_name}`}
                        onRemove={(doc) => removeMatch.mutate({ id: label.id, documentId: doc.document_id })}
                        onOpen={(doc) => onOpenDocument(doc.document_id)}
                        disabled={isBusy}
                    />
                </>
            )}
        </div>
    );
}
