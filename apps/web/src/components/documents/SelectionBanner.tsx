import { Button } from '@/components/ui/button';
import { useDeleteDocuments } from '@/lib/api/documents';
import { useConfirm } from '@/lib/confirm';
import { useSelection } from '@/lib/selection';
import { Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export function SelectionBanner() {
    const { selectedIds, clear } = useSelection();
    const confirm = useConfirm();
    const deleteDocuments = useDeleteDocuments();
    const count = selectedIds.size;

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: count === 1 ? 'Delete document?' : `Delete ${count} documents?`,
            description: 'This action cannot be undone.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'destructive',
        });
        if (!confirmed) return;
        const ids = Array.from(selectedIds);
        deleteDocuments.mutate(ids, {
            onSuccess: () => clear(),
        });
    };

    return (
        <AnimatePresence>
            {count > 0 && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 180, damping: 21 }}
                    className="overflow-hidden"
                >
                    <div className="flex items-center justify-between gap-4 border-b border-border bg-elevated py-3">
                        <span className="text-sm font-medium text-primary">
                            {count} selected
                        </span>
                        <div className="flex items-center gap-2">
                            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteDocuments.isPending}>
                                <Trash2 className="size-4" />
                                Delete
                            </Button>
                            <Button variant="ghost" size="sm" onClick={clear} disabled={deleteDocuments.isPending}>
                                <X className="size-4" />
                                Clear
                            </Button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
