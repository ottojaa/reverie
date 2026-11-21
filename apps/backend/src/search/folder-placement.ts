import type { RankedEntry } from './hybrid-search';

export interface PlaceableFolder {
    relevance: number | string | null;
    created_at: Date;
}

export type PageEntry<F extends PlaceableFolder = PlaceableFolder> = { type: 'document'; entry: RankedEntry } | { type: 'collection'; folder: F };

function precedes(folder: PlaceableFolder, doc: RankedEntry): boolean {
    const relevance = Number(folder.relevance ?? 0);

    return relevance > doc.wordRank || (relevance === doc.wordRank && folder.created_at.getTime() > doc.createdAt);
}

/**
 * Interleaves matching folders into a page of documents by word rank: a folder goes before the first
 * document whose word rank is lower (newest first on a tie), and folders no document is lower than follow the last one.
 * The fused order is not sorted by word rank, since a document only the meaning found has word rank 0 and can sit
 * between word matches. Those documents are skipped when placing, so they neither pull folders up to them
 * nor push a folder behind later word matches.
 */
export function placeFolders<F extends PlaceableFolder>(docs: readonly RankedEntry[], folders: readonly F[]): PageEntry<F>[] {
    const placed: PageEntry<F>[] = [];
    let next = 0;

    for (const entry of docs) {
        while (entry.match !== 'meaning' && next < folders.length && precedes(folders[next]!, entry)) {
            placed.push({ type: 'collection', folder: folders[next++]! });
        }

        placed.push({ type: 'document', entry });
    }

    return [...placed, ...folders.slice(next).map((folder): PageEntry<F> => ({ type: 'collection', folder }))];
}
