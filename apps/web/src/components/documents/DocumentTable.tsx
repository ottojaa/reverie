import { useVirtualTable } from '@/lib/hooks/useVirtualTable';
import { flattenTree } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import type { Document } from '@reverie/shared';
import { useMemo } from 'react';
import { DocumentRow } from './DocumentRow';
import { ROW_HEIGHT, TableShell, tableColumns } from './TableShell';

interface DocumentTableProps {
    documents: Document[];
    fetchNextPage?: () => void;
    hasNextPage?: boolean;
    /** Add the Folder column: only the library-wide view needs it, inside a folder every row is in that folder. */
    showFolder: boolean;
    /** Open at the scroll position the router remembered; false when the list is a different one than that was kept for. */
    restoreScroll?: boolean;
}

/** The Files view: newest first by upload date (the order the server pages in), so no column sorts. */
export function DocumentTable({ documents, fetchNextPage, hasNextPage, showFolder, restoreScroll = true }: DocumentTableProps) {
    const { data: sections } = useSections();
    const folderNames = useMemo(() => new Map(flattenTree(sections ?? []).map(({ folder }) => [folder.id, folder.name])), [sections]);
    const orderedIds = useMemo(() => documents.map((d) => d.id), [documents]);
    const columns = tableColumns(showFolder);
    const { bodyRef, virtualizer, virtualItems, scrollMargin } = useVirtualTable({
        cacheKey: 'files',
        rowCount: documents.length,
        rowKey: (index) => documents[index]?.id ?? index,
        rowHeight: ROW_HEIGHT,
        hasNextPage,
        fetchNextPage,
        restoreScroll,
    });

    return (
        <TableShell columns={columns} showFolder={showFolder} bodyRef={bodyRef} bodyHeight={virtualizer.getTotalSize()}>
            {virtualItems.map((virtualRow) => {
                const document = documents[virtualRow.index];

                if (!document) return null;

                return (
                    <DocumentRow
                        key={virtualRow.key}
                        document={document}
                        orderedIds={orderedIds}
                        columns={columns}
                        folderName={showFolder ? (document.folder_id ? (folderNames.get(document.folder_id) ?? null) : null) : undefined}
                        style={{ top: virtualRow.start - scrollMargin, height: virtualRow.size }}
                    />
                );
            })}
        </TableShell>
    );
}
