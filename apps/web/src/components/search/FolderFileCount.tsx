import { toTotalCount } from '@/lib/folders/tree.js';
import { useCurrentSection } from '@/lib/sections';
import type { CollectionSearchResult } from '@reverie/shared';

/** "N documents" for a folder search hit. The hit only counts the folder's own files, so the count with subfolders is read from the tree. */
export function FolderFileCount({ result }: { result: CollectionSearchResult }) {
    const folder = useCurrentSection(result.id);
    const count = folder ? toTotalCount(folder) : result.document_count;

    return (
        <>
            {count} {count === 1 ? 'document' : 'documents'}
        </>
    );
}
