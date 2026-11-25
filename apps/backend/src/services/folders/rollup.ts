import type { DocumentKind, FolderCover, FolderCoverTile, KindCounts } from '@reverie/shared';
import { sql } from 'kysely';
import { db } from '../../db/kysely.js';
import type { Folder } from '../../db/schema.js';
import { applyDocumentListFilters, IS_SCREEN_CAPTURE_SQL, type DocumentListFilters } from '../document-list-filters.js';
import { FILE_TYPE_SQL, KINDS, toSummary, TOP_TYPES, totalsOf } from '../document-summary.js';
import type { FolderLocks } from '../folder-locks.js';
import type { FolderTree } from './snapshot.js';

/**
 * What each folder holds, counting everything beneath it that is behind the same lock as the folder itself:
 * nothing under a private folder ever counts toward, or shows on, a folder above it. Three queries whatever
 * the number of folders, each over single folders, added up here along the tree.
 */

const COVER_TILES = 4;

/** Documents with a rendered thumbnail (a non-blank blurhash) rank ahead of those without. */
const HAS_THUMBNAIL_SQL = sql<boolean>`btrim(coalesce(thumbnail_blurhash, '')) <> ''`;

export interface FolderRollup {
    kind_counts: KindCounts;
    /** The folder's own documents only. */
    document_count: number;
    /**
     * Null for a private folder, open or not: private documents (ids, filenames) stay out of every listing and
     * are only reachable by asking for their folder.
     */
    cover: FolderCover | null;
}

/** For a folder nothing is told about, such as one behind a closed lock. */
export const EMPTY_ROLLUP: FolderRollup = { kind_counts: { image: 0, video: 0, file: 0 }, document_count: 0, cover: null };

type Filters = Omit<DocumentListFilters, 'kind'>;
type TileRow = Awaited<ReturnType<typeof fetchTiles>>[number];

interface Holdings {
    /** By the column names of totalsOf: `<kind>_count`, `<kind>_bytes`. */
    totals: Record<string, number>;
    types: Map<string, number>;
    /** The best COVER_TILES documents, best first. */
    tiles: TileRow[];
}

const TOTAL_COLUMNS = KINDS.flatMap((kind: DocumentKind) => [kind + '_count', kind + '_bytes']);

function fetchTotals(filters: Filters, folderIds: string[]) {
    return applyDocumentListFilters(
        db.selectFrom('documents').select((eb) => [eb.ref('folder_id').as('folder_id'), ...KINDS.flatMap((kind) => totalsOf(eb, kind))]),
        filters,
    )
        .where('folder_id', 'in', folderIds)
        .groupBy('folder_id')
        .execute();
}

/** Every file type of each folder, not only the most common: a type that is rare in each folder can lead their sum. */
function fetchTypes(filters: Filters, folderIds: string[]) {
    return applyDocumentListFilters(db.selectFrom('documents').select(['folder_id', FILE_TYPE_SQL.as('ext'), (eb) => eb.fn.countAll<string>().as('count')]), {
        ...filters,
        kind: 'file',
    })
        .where('folder_id', 'in', folderIds)
        .where(FILE_TYPE_SQL, '<>', '')
        .groupBy(['folder_id', 'ext'])
        .execute();
}

/** Each folder's best tiles: screen captures last, then thumbnailed first, then newest first. */
function fetchTiles(filters: Filters, folderIds: string[]) {
    const ranked = applyDocumentListFilters(
        db
            .selectFrom('documents')
            .select(['folder_id', 'id', 'mime_type', 'original_filename', 'thumbnail_blurhash', 'created_at'])
            .select([IS_SCREEN_CAPTURE_SQL.as('is_capture'), HAS_THUMBNAIL_SQL.as('has_thumbnail')])
            .select(
                sql<number>`row_number() over (partition by folder_id order by ${IS_SCREEN_CAPTURE_SQL}, ${HAS_THUMBNAIL_SQL} desc, created_at desc, id desc)`.as(
                    'rank',
                ),
            ),
        filters,
    ).where('folder_id', 'in', folderIds);

    return db.selectFrom(ranked.as('ranked')).selectAll().where('rank', '<=', COVER_TILES).orderBy('folder_id').orderBy('rank').execute();
}

/** The order of fetchTiles, for merging the tiles of several folders. */
function byTileRank(a: TileRow, b: TileRow): number {
    return (
        Number(a.is_capture) - Number(b.is_capture) ||
        Number(b.has_thumbnail) - Number(a.has_thumbnail) ||
        b.created_at.getTime() - a.created_at.getTime() ||
        b.id.localeCompare(a.id)
    );
}

function toEmptyHoldings(): Holdings {
    return { totals: Object.fromEntries(TOTAL_COLUMNS.map((column) => [column, 0])), types: new Map(), tiles: [] };
}

/** Each queried folder's own documents. Tiles are only asked for public folders. */
async function fetchOwnHoldings(userId: string, folderIds: string[], publicIds: string[]): Promise<Map<string, Holdings>> {
    // The folders asked for were chosen with their locks in mind, so the private filter is off here.
    const filters: Filters = { userId, privateFolderIds: [] };
    const [totals, types, tiles] = await Promise.all([
        folderIds.length === 0 ? [] : fetchTotals(filters, folderIds),
        folderIds.length === 0 ? [] : fetchTypes(filters, folderIds),
        publicIds.length === 0 ? [] : fetchTiles(filters, publicIds),
    ]);
    const own = new Map(folderIds.map((id) => [id, toEmptyHoldings()]));

    for (const row of totals) {
        const columns = row as unknown as Record<string, string>;

        own.get(row.folder_id!)!.totals = Object.fromEntries(TOTAL_COLUMNS.map((column) => [column, Number(columns[column])]));
    }

    for (const row of types) own.get(row.folder_id!)!.types.set(row.ext, Number(row.count));

    for (const row of tiles) own.get(row.folder_id!)!.tiles.push(row);

    return own;
}

function addHoldings(a: Holdings, b: Holdings): Holdings {
    const types = new Map(a.types);

    for (const [ext, count] of b.types) types.set(ext, (types.get(ext) ?? 0) + count);

    return {
        totals: Object.fromEntries(TOTAL_COLUMNS.map((column) => [column, a.totals[column]! + b.totals[column]!])),
        types,
        tiles: [...a.tiles, ...b.tiles].sort(byTileRank).slice(0, COVER_TILES),
    };
}

function toTile(row: TileRow): FolderCoverTile {
    const blurhash = row.thumbnail_blurhash?.trim() ? row.thumbnail_blurhash : null;

    return { document_id: row.id!, mime_type: row.mime_type, original_filename: row.original_filename, thumbnail_blurhash: blurhash };
}

function toCover(holdings: Holdings): FolderCover {
    const topTypes = Array.from(holdings.types, ([ext, count]) => ({ ext, count }))
        .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
        .slice(0, TOP_TYPES);

    return { tiles: holdings.tiles.map(toTile), summary: toSummary(holdings.totals, topTypes) };
}

function toRollup(own: Holdings, all: Holdings, isPrivate: boolean): FolderRollup {
    return {
        kind_counts: { image: all.totals['image_count']!, video: all.totals['video_count']!, file: all.totals['file_count']! },
        document_count: KINDS.reduce((sum, kind) => sum + own.totals[kind + '_count']!, 0),
        cover: isPrivate ? null : toCover(all),
    };
}

/**
 * The rollups of the given live folders and of every folder beneath them. A folder behind a closed lock has no
 * entry (see EMPTY_ROLLUP) and nothing of its documents is read.
 */
export async function loadFolderRollups(
    userId: string,
    tree: FolderTree<Folder>,
    folderIds: string[],
    locks: FolderLocks,
): Promise<Map<string, FolderRollup>> {
    const scope = new Map(folderIds.flatMap((id) => tree.subtree(id)).map((folder) => [folder.id, folder]));
    const open = Array.from(scope.keys()).filter((id) => !locks.isLocked(id));
    const own = await fetchOwnHoldings(
        userId,
        open,
        open.filter((id) => !locks.isPrivate(id)),
    );
    const sums = new Map<string, Holdings>();

    function sumOf(folderId: string): Holdings {
        const known = sums.get(folderId);

        if (known) return known;

        const sameLock = tree.children(folderId).filter((child) => locks.lockIdOf(child.id) === locks.lockIdOf(folderId));
        const sum = sameLock.reduce((total, child) => addHoldings(total, sumOf(child.id)), own.get(folderId)!);

        sums.set(folderId, sum);

        return sum;
    }

    return new Map(open.map((id) => [id, toRollup(own.get(id)!, sumOf(id), locks.isPrivate(id))]));
}
