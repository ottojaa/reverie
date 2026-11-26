import { useConfirm } from '@/lib/confirm';
import { toDeleteFolderMessage, toMakePrivateMessage } from '@/lib/folders/confirm-text.js';
import { fetchIsFolderGone } from '@/lib/folders/gone';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useDeleteFolder, useUpdateFolder } from '@/lib/sections';
import { useVault } from '@/lib/vault';
import type { FolderWithChildren } from '@reverie/shared';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { FolderRowActions } from './FolderRowMenu';

/**
 * After a delete: the open page may be the trashed folder or one inside it, so it moves to the folder above the
 * trashed one. The server says whether it is gone, since the tree lists nothing under a closed lock.
 */
function useLeaveTrashed(currentId: string | undefined) {
    const navigate = useNavigate();

    return async (trashed: FolderWithChildren) => {
        if (!currentId || !(await fetchIsFolderGone(currentId))) return;

        if (!trashed.parent_id) return navigate({ to: '/browse', replace: true });

        return navigate({ to: '/browse/$sectionId', params: { sectionId: trashed.parent_id }, replace: true });
    };
}

/** What the tree's row menu does. `currentId` is the folder the page shows. */
export function useFolderActions(currentId: string | undefined, onNewFolder: (parentId: string) => void): FolderRowActions {
    const confirm = useConfirm();
    const navigate = useNavigate();
    const { hasPassword, requestUnlock } = useVault();
    const { openEdit } = useSectionEdit();
    const deleteFolder = useDeleteFolder();
    const updateFolder = useUpdateFolder();
    const leaveTrashed = useLeaveTrashed(currentId);

    async function onDelete(folder: FolderWithChildren) {
        const ok = await confirm({
            title: 'Delete folder?',
            description: toDeleteFolderMessage(folder),
            confirmText: 'Delete',
            variant: 'destructive',
        });

        if (!ok) return;

        // Awaited rather than a callback on `mutate`, which is dropped if the tree has unmounted by then.
        const isDeleted = await deleteFolder.mutateAsync(folder.id).then(
            () => true,
            () => false,
        );

        if (isDeleted) await leaveTrashed(folder);
    }

    async function onTogglePrivate(folder: FolderWithChildren) {
        const makePrivate = !folder.is_private;

        // Making a folder public needs its lock open, so a locked one asks to be unlocked first.
        if (folder.locked && !(await requestUnlock(folder.id))) return;

        // Making a folder private hides everything inside it too, so confirm when it holds subfolders.
        if (makePrivate && folder.children.length > 0) {
            const ok = await confirm({ title: 'Make folder private?', description: toMakePrivateMessage(folder), confirmText: 'Make private' });

            if (!ok) return;
        }

        updateFolder.mutate({ id: folder.id, data: { is_private: makePrivate } });

        // Without an account password nothing can be locked, so say where to set one (never block).
        if (makePrivate && hasPassword === false) {
            toast.info('Private folders are only locked once your account has a password. Set one in Settings.', {
                action: { label: 'Open Settings', onClick: () => void navigate({ to: '/settings' }) },
            });
        }
    }

    return {
        onNewFolder,
        onEdit: openEdit,
        onDelete: (folder) => void onDelete(folder),
        onTogglePrivate: (folder) => void onTogglePrivate(folder),
    };
}
