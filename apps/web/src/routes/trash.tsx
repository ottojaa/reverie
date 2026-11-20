import { isLockedFolderEntry, toTrashItemKey, TrashRow, type TrashItem } from '@/components/trash/TrashRow';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api/client';
import { useEmptyTrash, usePurgeFromTrash, useRestoreFromTrash, useTrash, type TrashSelection } from '@/lib/api/trash';
import { useConfirm } from '@/lib/confirm';
import { useVault } from '@/lib/vault';
import { createFileRoute } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/trash')({
    component: TrashPage,
});

function toSelection(entries: TrashItem[]): TrashSelection {
    return {
        document_ids: entries.filter((e) => e.kind === 'document').map((e) => e.item.id),
        folder_ids: entries.filter((e) => e.kind === 'folder').map((e) => e.item.id),
    };
}

function describeCount(entries: TrashItem[]): string {
    return entries.length === 1 ? 'This item' : `These ${entries.length} items`;
}

function TrashPage() {
    const { data, isLoading, error } = useTrash();
    const restore = useRestoreFromTrash();
    const purge = usePurgeFromTrash();
    const emptyTrash = useEmptyTrash();
    const confirm = useConfirm();
    const { requestUnlock } = useVault();
    const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());

    const entries = useMemo<TrashItem[]>(
        () => [
            ...(data?.folders ?? []).map((item): TrashItem => ({ kind: 'folder', item })),
            ...(data?.documents ?? []).map((item): TrashItem => ({ kind: 'document', item })),
        ],
        [data],
    );
    const selected = entries.filter((entry) => selectedKeys.has(toTrashItemKey(entry)));
    const busy = restore.isPending || purge.isPending || emptyTrash.isPending;
    const allSelected = entries.length > 0 && selected.length === entries.length;

    const toggle = (entry: TrashItem) => {
        const key = toTrashItemKey(entry);
        const next = new Set(selectedKeys);

        if (next.has(key)) next.delete(key);
        else next.add(key);

        setSelectedKeys(next);
    };

    // Unlocking refetches the trash, so the folder's real name replaces the bare row.
    const handleUnlock = (entry: TrashItem) => {
        void requestUnlock(entry.item.id);
    };

    // A locked folder can only be restored after it is unlocked, so bulk restores leave those out.
    const restorable = selected.filter((entry) => !isLockedFolderEntry(entry));

    const handleRestore = (targets: TrashItem[]) => {
        restore.mutate(toSelection(targets.filter((entry) => !isLockedFolderEntry(entry))), { onSuccess: () => setSelectedKeys(new Set()) });
    };

    const handlePurge = async (targets: TrashItem[]) => {
        const ok = await confirm({
            title: 'Delete forever?',
            description: `${describeCount(targets)} will be permanently deleted. This cannot be undone.`,
            confirmText: 'Delete forever',
            variant: 'destructive',
        });

        if (!ok) return;

        purge.mutate(toSelection(targets), { onSuccess: () => setSelectedKeys(new Set()) });
    };

    const handleEmpty = async () => {
        const ok = await confirm({
            title: 'Empty trash?',
            description: `Everything in the trash (${entries.length} item${entries.length === 1 ? '' : 's'}) will be permanently deleted. This cannot be undone.`,
            confirmText: 'Empty trash',
            variant: 'destructive',
        });

        if (!ok) return;

        emptyTrash.mutate(undefined, { onSuccess: () => setSelectedKeys(new Set()) });
    };

    return (
        <div className="container max-w-4xl p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Trash</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {data
                            ? `Deleted items are kept for ${data.retention_days} day${data.retention_days === 1 ? '' : 's'}, then removed for good. Restored folders come back empty.`
                            : 'Deleted items are kept for a while, then removed for good.'}
                    </p>
                </div>
                <Button type="button" variant="destructive" size="sm" onClick={handleEmpty} disabled={busy || entries.length === 0}>
                    <Trash2 className="size-3.5" />
                    Empty trash
                </Button>
            </div>

            {entries.length > 0 && (
                <div className="mb-3 flex min-h-9 flex-wrap items-center gap-3 px-1">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) => setSelectedKeys(checked === true ? new Set(entries.map(toTrashItemKey)) : new Set())}
                            aria-label="Select all"
                        />
                        {selected.length > 0 ? `${selected.length} selected` : 'Select all'}
                    </label>
                    {selected.length > 0 && (
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleRestore(selected)}
                                disabled={busy || restorable.length === 0}
                            >
                                <RotateCcw className="size-3.5" />
                                Restore selected
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => handlePurge(selected)} disabled={busy}>
                                <Trash2 className="size-3.5" />
                                Delete selected forever
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                {isLoading && (
                    <div className="space-y-3 p-4">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                )}
                {error && <p className="p-5 text-sm text-destructive">{getApiErrorMessage(error, 'Failed to load trash')}</p>}
                {!isLoading && !error && entries.length === 0 && (
                    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                        <Trash2 className="size-8 text-muted-foreground" aria-hidden />
                        <p className="text-sm font-medium">Trash is empty</p>
                        <p className="text-sm text-muted-foreground">Documents and folders you delete show up here until they are purged.</p>
                    </div>
                )}
                <ul className="divide-y divide-border">
                    {entries.map((entry) => (
                        <TrashRow
                            key={toTrashItemKey(entry)}
                            entry={entry}
                            selected={selectedKeys.has(toTrashItemKey(entry))}
                            busy={busy}
                            onToggle={() => toggle(entry)}
                            onRestore={() => handleRestore([entry])}
                            onUnlock={() => handleUnlock(entry)}
                            onPurge={() => handlePurge([entry])}
                        />
                    ))}
                </ul>
            </div>
        </div>
    );
}
