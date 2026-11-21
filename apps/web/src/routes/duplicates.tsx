import { DuplicateGroupCard } from '@/components/duplicates/DuplicateGroupCard';
import { countToTrash, toKeepId } from '@/components/duplicates/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api/client';
import { useDismissDuplicates, useDuplicates, useTrashOthers } from '@/lib/api/duplicates';
import { getLockedFolderId } from '@/lib/api/folder-locked';
import { useConfirm } from '@/lib/confirm';
import { useVault } from '@/lib/vault';
import type { DuplicateGroup } from '@reverie/shared';
import { createFileRoute } from '@tanstack/react-router';
import { Copy, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/duplicates')({
    // A private folder or collection: its duplicates are listed apart from the rest, and only while its lock is open.
    validateSearch: (search?: { folder?: string }): { folder?: string } => (typeof search?.folder === 'string' ? { folder: search.folder } : {}),
    component: DuplicatesPage,
});

function DuplicatesPage() {
    const { folder } = Route.useSearch();
    const { data, isLoading, error, refetch } = useDuplicates(folder);
    const trashOthers = useTrashOthers(folder);
    const dismiss = useDismissDuplicates(folder);
    const confirm = useConfirm();
    const { requestUnlock } = useVault();
    // The copy the owner picked per group; a group without an entry keeps its suggested copy.
    const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
    const groups = data?.groups ?? [];
    const busy = trashOthers.isPending || dismiss.isPending;
    const lockedFolderId = getLockedFolderId(error);

    const trashGroups = (targets: DuplicateGroup[]) =>
        trashOthers.mutate(targets.map((group) => ({ group_id: group.id, keep_id: toKeepId(group, picked[group.id]) })));

    const handleTrashAll = async () => {
        const count = countToTrash(groups);
        const ok = await confirm({
            title: `Move ${count} ${count === 1 ? 'image' : 'images'} to Trash?`,
            description: `One copy of each of the ${groups.length} groups stays: the one marked Keep. You can undo this from the toast or restore from Trash.`,
            confirmText: 'Move to Trash',
        });

        if (ok) trashGroups(groups);
    };

    const handleUnlock = async () => {
        if (lockedFolderId && (await requestUnlock(lockedFolderId))) void refetch();
    };

    return (
        <div className="container max-w-5xl p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Duplicates</h1>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                        Pictures that are the same or nearly so: burst shots, resized or re-compressed copies, edits and their originals. Pick the copy to keep;
                        the rest go to the Trash, where you can restore them. Nothing is deleted for you.
                    </p>
                </div>
                <Button type="button" size="sm" onClick={handleTrashAll} disabled={busy || groups.length === 0}>
                    <Trash2 className="size-3.5" />
                    Move others to Trash{groups.length > 0 ? ` (${countToTrash(groups)})` : ''}
                </Button>
            </div>

            {isLoading && (
                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <Skeleton key={i} className="h-72 w-full rounded-xl" />
                    ))}
                </div>
            )}
            {lockedFolderId && (
                <div className="flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-16 text-center shadow-sm">
                    <Lock className="size-8 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">This private folder is locked</p>
                    <Button type="button" variant="outline" size="sm" onClick={handleUnlock}>
                        Unlock
                    </Button>
                </div>
            )}
            {error && !lockedFolderId && <p className="text-sm text-destructive">{getApiErrorMessage(error, 'Failed to load duplicates')}</p>}
            {data && groups.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-16 text-center shadow-sm">
                    <Copy className="size-8 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">No duplicates found</p>
                    <p className="text-sm text-muted-foreground">New pictures are checked as they are processed, so this fills in by itself.</p>
                </div>
            )}
            <div className="space-y-4">
                {groups.map((group) => (
                    <DuplicateGroupCard
                        key={group.id}
                        group={group}
                        keepId={toKeepId(group, picked[group.id])}
                        busy={busy}
                        onKeep={(memberId) => setPicked({ ...picked, [group.id]: memberId })}
                        onTrashOthers={() => trashGroups([group])}
                        onDismiss={() => dismiss.mutate(group.id)}
                    />
                ))}
            </div>
        </div>
    );
}
