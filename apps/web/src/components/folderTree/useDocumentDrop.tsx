import { documentsApi } from '@/lib/api/documents';
import { useMoveDocuments } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import { useVault } from '@/lib/vault';
import type { Document, FolderWithChildren } from '@reverie/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { DuplicateOptionsDialog, type ConflictStrategy } from '../upload/DuplicateOptionsDialog';

interface PendingMove {
    documentIds: string[];
    folderId: string;
    duplicateFilenames: string[];
}

function getDocumentFilenamesFromCache(queryClient: QueryClient, documentIds: string[]): string[] {
    const idToFilename = new Map<string, string>();
    const queries = queryClient.getQueriesData<{ items?: Document[]; pages?: { items: Document[] }[] }>({ queryKey: ['documents'] });

    for (const [, data] of queries) {
        if (!data) continue;

        const items: Document[] = 'pages' in data && Array.isArray(data.pages) ? data.pages.flatMap((p) => p.items ?? []) : (data.items ?? []);

        for (const doc of items) {
            if (!idToFilename.has(doc.id)) {
                idToFilename.set(doc.id, doc.original_filename);
            }
        }
    }

    return documentIds.map((id) => idToFilename.get(id) ?? '').filter(Boolean);
}

/** Moving documents that were dropped on a folder, asking first when it already holds files of those names. */
export function useDocumentDrop() {
    const queryClient = useQueryClient();
    const moveDocuments = useMoveDocuments();
    const selection = useSelectionOptional();
    const { requestUnlock } = useVault();
    const [pending, setPending] = useState<PendingMove | null>(null);

    function move(documentIds: string[], folderId: string, strategy?: ConflictStrategy) {
        moveDocuments.mutate(
            { document_ids: documentIds, folder_id: folderId, ...(strategy && { conflict_strategy: strategy }) },
            {
                onSuccess: () => {
                    selection?.clear();
                    toast.success(documentIds.length === 1 ? '1 file moved successfully' : `${documentIds.length} files moved successfully`);
                },
            },
        );
    }

    async function drop(documentIds: string[], folder: FolderWithChildren) {
        if (documentIds.length === 0) return;

        // The duplicate check reads the folder, so a locked one has to be opened first.
        if (folder.locked && !(await requestUnlock(folder.id))) return;

        const filenames = getDocumentFilenamesFromCache(queryClient, documentIds);

        if (filenames.length === 0) return move(documentIds, folder.id);

        try {
            const { duplicates } = await documentsApi.checkDuplicates(folder.id, filenames);

            if (duplicates.length > 0) return setPending({ documentIds, folderId: folder.id, duplicateFilenames: duplicates });
        } catch {
            toast.error('Failed to check for duplicates');
        }

        move(documentIds, folder.id);
    }

    const dialog = (
        <DuplicateOptionsDialog
            title="File exists in destination"
            open={pending !== null}
            duplicateFilenames={pending?.duplicateFilenames ?? []}
            action="move"
            onConfirm={(strategy) => {
                if (!pending) return;

                move(pending.documentIds, pending.folderId, strategy);
                setPending(null);
            }}
            onCancel={() => setPending(null)}
        />
    );

    return { drop, dialog };
}
