import { findFolderChain } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';

/** What to call the folder search is narrowed to: its name, and its whole path for a tooltip. */
export function useFolderFilterName(folderId: string | undefined): { name: string; path: string } | null {
    const { data: tree } = useSections();

    if (!folderId) return null;

    const names = findFolderChain(tree ?? [], folderId).map((folder) => folder.name);

    return { name: names.at(-1) ?? 'Unknown folder', path: names.join(' / ') };
}
