import { Button } from '@/components/ui/button';
import { useDeleteDocuments } from '@/lib/api/documents';
import { useConfirm } from '@/lib/confirm';
import { useSelection } from '@/lib/selection';
import { useLocation } from '@tanstack/react-router';
import { Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

export function SelectionBanner() {
    const { pathname } = useLocation();
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

    useEffect(() => {
        clear();
    }, [pathname]);

    return (
        <AnimatePresence>
            {count > 0 && (
                <motion.div
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '100%', opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className="fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-border bg-card/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-4px_rgba(0,0,0,0.08)] backdrop-blur-sm dark:shadow-[0_-8px_24px_-4px_rgba(0,0,0,0.35)]"
                >
                    <div className="flex w-full max-w-7xl items-center justify-between gap-4 px-4 pt-3">
                        <span className="text-sm font-medium text-primary">{count} selected</span>
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
