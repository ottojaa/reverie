import type { CollectionSearchResult } from '@reverie/shared';

/** "N files" for a folder search hit: its own and its subfolders', as the sidebar counts them. */
export function FolderFileCount({ result }: { result: CollectionSearchResult }) {
    const count = result.document_count;

    return (
        <>
            {count} {count === 1 ? 'file' : 'files'}
        </>
    );
}
