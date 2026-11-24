import { useDeleteDocuments } from '@/lib/api/documents';
import { useConfirm } from '@/lib/confirm';
import { useSelectionOptional } from '@/lib/selection';

/** Asks before moving `ids` to Trash, then does it and clears the selection. */
export function useConfirmedDelete() {
    const selection = useSelectionOptional();
    const confirm = useConfirm();
    const deleteDocuments = useDeleteDocuments();

    return async function deleteWithConfirm(ids: string[]) {
        const count = ids.length;
        const confirmed = await confirm({
            title: count === 1 ? 'Move document to Trash?' : `Move ${count} documents to Trash?`,
            description:
                count === 1
                    ? 'The document moves to Trash. You can restore it there until it is purged.'
                    : 'The documents move to Trash. You can restore them there until they are purged.',
            confirmText: 'Move to Trash',
            cancelText: 'Cancel',
            variant: 'destructive',
        });

        if (!confirmed) return;

        deleteDocuments.mutate(ids, {
            onSuccess: () => selection?.clear(),
        });
    };
}
