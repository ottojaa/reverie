import { Button } from '@/components/ui/button';
import { useDeleteDocuments } from '@/lib/api/documents';
import { buildDownloadUrl, buildFileUrl } from '@/lib/commonhelpers';
import { useConfirm } from '@/lib/confirm';
import { useSelection } from '@/lib/selection';
import type { Document } from '@reverie/shared';
import { useLocation } from '@tanstack/react-router';
import { Download, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

export function SelectionBanner({ documents }: { documents: Document[] }) {
    const { pathname } = useLocation();
    const { selectedIds, clear } = useSelection();
    const confirm = useConfirm();
    const deleteDocuments = useDeleteDocuments();
    const count = selectedIds.size;

    const handleDownload = () => {
        const byId = new Map(documents.map((doc) => [doc.id, doc]));
        const targets = Array.from(selectedIds)
            .map((id) => byId.get(id))
            .filter((doc): doc is Document => doc != null);

        // Stagger the clicks so the browser doesn't collapse rapid downloads into just one.
        targets.forEach((doc, index) => {
            const fileUrl = buildFileUrl(doc.file_url);

            if (!fileUrl) return;

            window.setTimeout(() => {
                const a = window.document.createElement('a');
                a.href = buildDownloadUrl(fileUrl, doc.original_filename);
                a.rel = 'noopener';
                a.click();
            }, index * 300);
        });
    };

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
                            <Button variant="outline" size="sm" onClick={handleDownload} disabled={deleteDocuments.isPending}>
                                <Download className="size-4" />
                                Download
                            </Button>
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
