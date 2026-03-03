import { Button } from '@/components/ui/button';
import { useExecuteOrganize } from '@/lib/api/organize';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import type { OrganizeOperation, OrganizeProposalEvent } from '@reverie/shared';
import { produce } from 'immer';
import { CheckCircle2, FolderOpen, FolderPlus, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

interface OrganizePreviewProps {
    proposal: OrganizeProposalEvent;
    onProposalChange: (proposal: OrganizeProposalEvent | null) => void;
    onClose: () => void;
}

function isMoveOp(op: OrganizeOperation): op is Extract<OrganizeOperation, { type: 'move' | 'create_and_move' }> {
    return op.type === 'move' || op.type === 'create_and_move';
}

export function OrganizePreview({ proposal, onProposalChange, onClose }: OrganizePreviewProps) {
    const execute = useExecuteOrganize();
    const [done, setDone] = useState<{ moved: number; folders: number; deleted: number } | null>(null);

    const totalDocs = proposal.operations.reduce((sum, op) => (isMoveOp(op) ? sum + op.document_ids.length : sum), 0);
    const totalDeletes = proposal.operations.filter((op) => op.type === 'delete_folder').length;
    const totalFolders = proposal.operations.filter(isMoveOp).length;
    const hasOperations = proposal.operations.length > 0;

    const removeDocument = (opIndex: number, docId: string) => {
        const op = proposal.operations[opIndex];

        if (!op || !isMoveOp(op)) return;

        const next = produce(proposal, (draft) => {
            const d = draft.operations[opIndex];

            if (!d || !isMoveOp(d)) return;

            d.document_ids = d.document_ids.filter((id) => id !== docId);
            d.document_previews = d.document_previews.filter((p) => p.id !== docId);
        });

        const cleaned = produce(next, (draft) => {
            draft.operations = draft.operations.filter((o) => !isMoveOp(o) || o.document_ids.length > 0);
        });

        if (cleaned.operations.length === 0) {
            onProposalChange(null);
        } else {
            onProposalChange(cleaned);
        }
    };

    const removeDeleteOp = (opIndex: number) => {
        const cleaned = produce(proposal, (draft) => {
            draft.operations = draft.operations.filter((_, i) => i !== opIndex);
        });

        if (cleaned.operations.length === 0) {
            onProposalChange(null);
        } else {
            onProposalChange(cleaned);
        }
    };

    const handleConfirm = async () => {
        const result = await execute.mutateAsync(proposal.operations as OrganizeOperation[]);
        setDone({ moved: result.moved_count, folders: result.folders_created, deleted: result.folders_deleted });
    };

    if (done) {
        return (
            <motion.div
                className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', duration: 0.4 }}
            >
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1, duration: 0.5 }}>
                    <CheckCircle2 className="size-12 text-success" />
                </motion.div>
                <div>
                    <p className="text-lg font-semibold text-foreground">Done!</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {done.moved > 0 && (
                            <>
                                Moved {done.moved} {done.moved === 1 ? 'document' : 'documents'}
                                {done.folders > 0 && ` into ${done.folders} new ${done.folders === 1 ? 'folder' : 'folders'}`}.
                            </>
                        )}
                        {done.deleted > 0 && (
                            <>
                                {done.moved > 0 && ' '}
                                Removed {done.deleted} empty {done.deleted === 1 ? 'folder' : 'folders'}.
                            </>
                        )}
                        {done.moved === 0 && done.deleted === 0 && 'No changes applied.'}
                    </p>
                </div>
                <Button onClick={onClose} variant="outline" size="sm">
                    Close
                </Button>
            </motion.div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Sparkles className="size-4 shrink-0 text-primary" />
                <span className="text-sm font-medium text-foreground">Proposed changes</span>
                <span className="ml-auto text-xs text-muted-foreground">
                    {totalDocs > 0 && (
                        <>
                            {totalDocs} {totalDocs === 1 ? 'document' : 'documents'}
                            {(totalFolders > 0 || totalDeletes > 0) && ' · '}
                        </>
                    )}
                    {totalFolders > 0 && (
                        <>
                            {totalFolders} {totalFolders === 1 ? 'folder' : 'folders'}
                            {totalDeletes > 0 && ' · '}
                        </>
                    )}
                    {totalDeletes > 0 && (
                        <>
                            {totalDeletes} {totalDeletes === 1 ? 'folder' : 'folders'} to remove
                        </>
                    )}
                </span>
            </div>

            {/* Summary */}
            <div className="border-b border-border bg-card px-4 py-3">
                <p className="text-sm text-muted-foreground leading-relaxed">{proposal.summary}</p>
            </div>

            {/* Operations list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <AnimatePresence initial={false}>
                    {proposal.operations.map((op, opIdx) =>
                        op.type === 'delete_folder' ? (
                            <motion.div
                                key={`delete-${op.folder_id}-${opIdx}`}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="rounded-lg border border-border bg-card overflow-hidden"
                            >
                                <div className="flex items-center gap-2 px-3 py-2.5 bg-card">
                                    <Trash2 className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="text-sm font-medium text-foreground truncate flex-1">
                                        Remove empty folder: {op.folder_name}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => removeDeleteOp(opIdx)}
                                        className="size-6 shrink-0"
                                        title="Remove from proposal"
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key={`${op.target_folder.name}-${opIdx}`}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="rounded-lg border border-border bg-card overflow-hidden"
                            >
                                {/* Folder header */}
                                <div className="flex items-start gap-2 px-3 py-2.5 bg-card">
                                    {op.target_folder.is_new ? (
                                        <FolderPlus className="size-4 mt-0.5 shrink-0 text-primary" />
                                    ) : (
                                        <FolderOpen className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        {op.target_folder.new_parent_name && (
                                            <p className="truncate text-[10px] text-muted-foreground">
                                                New collection: {op.target_folder.new_parent_name}
                                            </p>
                                        )}
                                        <span className="text-sm font-medium text-foreground truncate block">{op.target_folder.name}</span>
                                    </div>
                                    {op.target_folder.is_new && (
                                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                            New
                                        </span>
                                    )}
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {op.document_ids.length} {op.document_ids.length === 1 ? 'doc' : 'docs'}
                                    </span>
                                </div>

                                {/* Thumbnail grid - show first 10, then "and N more" */}
                                <div className="grid grid-cols-3 gap-1.5 p-2">
                                    <AnimatePresence initial={false}>
                                        {op.document_previews.slice(0, 10).map((doc) => {
                                            const thumbUrl = getThumbnailUrl(doc, 'sm');

                                            return (
                                                <motion.div
                                                    key={doc.id}
                                                    layout
                                                    initial={{ opacity: 0, scale: 0.8 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.7 }}
                                                    className="group relative aspect-square rounded overflow-hidden bg-secondary"
                                                >
                                                    {thumbUrl ? (
                                                        <img src={thumbUrl} alt={doc.display_name} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center">
                                                            <span className="text-[10px] text-muted-foreground uppercase font-medium">
                                                                {doc.mime_type.split('/')[1]?.slice(0, 3) ?? 'file'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/40">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            onClick={() => removeDocument(opIdx, doc.id)}
                                                            className="absolute right-0.5 top-0.5 size-6 rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70 hover:text-white"
                                                            title="Remove from proposal"
                                                        >
                                                            <X className="size-2.5" />
                                                        </Button>
                                                    </div>
                                                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent px-1 pb-0.5 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <p className="truncate text-[9px] text-white leading-tight">{doc.display_name}</p>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                    {op.document_ids.length > 10 && (
                                        <p className="col-span-full px-1 pt-1 text-xs text-muted-foreground">
                                            and {op.document_ids.length - 10} more
                                        </p>
                                    )}
                                </div>
                            </motion.div>
                        ),
                    )}
                </AnimatePresence>
            </div>

            {/* Footer actions */}
            <div className="border-t border-border p-3 flex items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onProposalChange(null)} disabled={execute.isPending}>
                    Discard
                </Button>
                <Button size="sm" className="flex-1" onClick={handleConfirm} disabled={execute.isPending || !hasOperations}>
                    {execute.isPending ? (
                        <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            Applying...
                        </>
                    ) : (
                        <>Confirm ({totalDocs + totalDeletes})</>
                    )}
                </Button>
            </div>
        </div>
    );
}
