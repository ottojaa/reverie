import { useExpandedGroups } from '@/lib/browse/expanded-groups';
import { groupFolderId, recentEntries, recentRows, rowDocumentIds, type RecentEntry } from '@/lib/browse/recent-rows';
import { useVirtualTable } from '@/lib/hooks/useVirtualTable';
import { flattenTree } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import type { Document } from '@reverie/shared';
import { useMemo } from 'react';
import { DocumentRow } from './DocumentRow';
import { RecentGroupRow } from './RecentGroupRow';
import { ROW_HEIGHT, TableShell, tableColumns } from './TableShell';

interface RecentTableProps {
    /** The loaded documents, newest first. */
    documents: Document[];
    /** 'library', or the folder's id: names the list whose opened groups are remembered. */
    scope: string;
    showFolder: boolean;
    fetchNextPage?: () => void;
    hasNextPage?: boolean;
}

/** Recently added: the newest documents with batches of media folded into one row and same-name files stacked. */
export function RecentTable({ documents, scope, showFolder, fetchNextPage, hasNextPage }: RecentTableProps) {
    const { data: sections } = useSections();
    const folderNames = useMemo(() => new Map(flattenTree(sections ?? []).map(({ folder }) => [folder.id, folder.name])), [sections]);
    const { open, toggle } = useExpandedGroups(scope);
    const rows = useMemo(() => recentRows(documents), [documents]);
    const entries = useMemo(() => recentEntries(rows, open), [rows, open]);
    // Range selection runs over every loaded document in the order the list shows them, collapsed members included.
    const orderedIds = useMemo(() => rows.flatMap(rowDocumentIds), [rows]);
    const columns = tableColumns(showFolder);
    const { bodyRef, virtualizer, virtualItems, scrollMargin } = useVirtualTable({
        cacheKey: `recent:${scope}`,
        rowCount: entries.length,
        rowKey: (index) => entries[index]?.key ?? index,
        rowHeight: ROW_HEIGHT,
        hasNextPage,
        fetchNextPage,
    });

    const folderName = (folderId: string | null) => (showFolder ? (folderId ? (folderNames.get(folderId) ?? null) : null) : undefined);

    const renderEntry = (entry: RecentEntry<Document>, style: React.CSSProperties) => {
        if (entry.type === 'member') {
            return (
                <DocumentRow
                    key={entry.key}
                    document={entry.doc}
                    orderedIds={orderedIds}
                    columns={columns}
                    folderName={folderName(entry.doc.folder_id)}
                    style={style}
                    leading="thumbnail"
                    member
                />
            );
        }

        const { row } = entry;

        if (row.type === 'group') {
            return (
                <RecentGroupRow
                    key={entry.key}
                    row={row}
                    expanded={entry.expanded}
                    onToggle={toggle}
                    orderedIds={orderedIds}
                    columns={columns}
                    folderName={folderName(groupFolderId(row))}
                    style={style}
                />
            );
        }

        return (
            <DocumentRow
                key={entry.key}
                document={row.doc}
                orderedIds={orderedIds}
                columns={columns}
                folderName={folderName(row.doc.folder_id)}
                style={style}
                leading="thumbnail"
            />
        );
    };

    return (
        <TableShell columns={columns} showFolder={showFolder} bodyRef={bodyRef} bodyHeight={virtualizer.getTotalSize()}>
            {virtualItems.map((virtualRow) => {
                const entry = entries[virtualRow.index];

                return entry ? renderEntry(entry, { top: virtualRow.start - scrollMargin, height: virtualRow.size }) : null;
            })}
        </TableShell>
    );
}
