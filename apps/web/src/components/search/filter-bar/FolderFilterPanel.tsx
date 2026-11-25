import { FolderPickList } from '@/components/folders/FolderPickList';
import { Input } from '@/components/ui/input';
import { flattenTree, searchTree, toPublicTree } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

export interface FolderFilterProps {
    folderId: string | undefined;
    onChange: (folderId: string | undefined) => void;
}

/**
 * Picks the folder to search in, subfolders included. Search never returns private documents, so private
 * folders are not offered. Picking the picked folder again clears the filter.
 */
export function FolderFilterPanel({ folderId, onChange }: FolderFilterProps) {
    const { data: tree } = useSections();
    const [query, setQuery] = useState('');
    const publicTree = useMemo(() => toPublicTree(tree ?? []), [tree]);
    const rows = query.trim() ? searchTree(publicTree, query) : flattenTree(publicTree);

    return (
        <div className="flex flex-col">
            <div className="px-3 pb-1.5 pt-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Folder</span>
            </div>

            <div className="px-2 pb-1">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search folder..." className="h-8 pl-8 pr-3 text-sm" />
                </div>
            </div>

            <div className="max-h-64 overflow-y-auto p-1">
                <FolderPickList
                    rows={rows}
                    selected={folderId}
                    onPick={(picked) => onChange(picked && picked !== folderId ? picked : undefined)}
                    hasCounts
                    emptyText={query ? 'No matches' : 'No folders in your library yet'}
                />
            </div>
        </div>
    );
}
