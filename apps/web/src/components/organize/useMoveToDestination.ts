import { findFolder } from '@/lib/folders/tree.js';
import { useCreateFolder, useMoveDocuments } from '@/lib/sections';
import type { FolderWithChildren } from '@reverie/shared';
import { toast } from 'sonner';
import type { MoveDestination } from './FolderPickerPanel';

function toDestinationName(sections: FolderWithChildren[], destination: MoveDestination): string {
    if (destination.type === 'new') return `"${destination.name}"`;

    const folder = findFolder(sections, destination.folderId);

    return folder ? `"${folder.name}"` : 'the top level';
}

/** Moves documents to a destination, creating the folder first when it is a new one. */
export function useMoveToDestination(sections: FolderWithChildren[]) {
    const createFolder = useCreateFolder();
    const moveDocuments = useMoveDocuments();

    async function toFolderId(destination: MoveDestination): Promise<string | null> {
        if (destination.type === 'existing') return destination.folderId;

        const { name, parentId } = destination;
        const folder = await createFolder.mutateAsync({ name, ...(parentId && { parent_id: parentId }) });

        return folder.id;
    }

    /** True once the documents are there. On failure the mutation that failed has said why. */
    async function moveTo(documentIds: string[], destination: MoveDestination): Promise<boolean> {
        try {
            const folderId = await toFolderId(destination);
            await moveDocuments.mutateAsync({ document_ids: documentIds, folder_id: folderId });
        } catch {
            return false;
        }

        const noun = documentIds.length === 1 ? 'document' : 'documents';
        toast.success(`Moved ${documentIds.length} ${noun} to ${toDestinationName(sections, destination)}`);

        return true;
    }

    return { moveTo, isMoving: createFolder.isPending || moveDocuments.isPending };
}
