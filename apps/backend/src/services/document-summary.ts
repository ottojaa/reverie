import type { DocumentKind, DocumentSummaryResponse, FolderCover, FolderCoverTile } from '@reverie/shared';
import { sql, type ExpressionBuilder } from 'kysely';
import { db } from '../db/kysely.js';
import type { Database } from '../db/schema.js';
import { applyDocumentListFilters, isOfKind, type DocumentListFilters } from './document-list-filters.js';

const TOP_TYPES = 4;
const KINDS: DocumentKind[] = ['image', 'video', 'file'];

/** The type a file shows as: the lowercase extension of its name ('' when it has none, and then it counts toward no type). */
const FILE_TYPE_SQL = sql<string>`coalesce(substring(lower(original_filename) from '\\.([^.]+)$'), '')`;

function totalsOf(eb: ExpressionBuilder<Database, 'documents'>, kind: DocumentKind) {
    return [
        eb.fn
            .countAll<string>()
            .filterWhere(isOfKind(eb, kind))
            .as(kind + '_count'),
        eb.fn.coalesce(eb.fn.sum<string>('size_bytes').filterWhere(isOfKind(eb, kind)), sql<string>`0`).as(kind + '_bytes'),
    ];
}

/**
 * What the documents the filters select hold, per kind: how many and how many bytes, and the most common file types.
 * Both queries go through applyDocumentListFilters (without a kind), so the scope matches GET /documents exactly.
 */
export async function summariseDocuments(filters: Omit<DocumentListFilters, 'kind'>): Promise<DocumentSummaryResponse> {
    const totals = applyDocumentListFilters(
        db.selectFrom('documents').select((eb) => KINDS.flatMap((kind) => totalsOf(eb, kind))),
        filters,
    ).executeTakeFirstOrThrow();
    const types = applyDocumentListFilters(db.selectFrom('documents').select([FILE_TYPE_SQL.as('ext'), (eb) => eb.fn.countAll<string>().as('count')]), {
        ...filters,
        kind: 'file',
    })
        .where(FILE_TYPE_SQL, '<>', '')
        .groupBy('ext')
        .orderBy('count', 'desc')
        .orderBy('ext')
        .limit(TOP_TYPES)
        .execute();
    const [row, topTypes] = await Promise.all([totals, types]);

    return toSummary(row, topTypes);
}

/** One row of totalsOf's columns: `<kind>_count` and `<kind>_bytes`, as the strings the driver returns. */
type TotalsRow = Record<string, string | null>;

function toSummary(row: TotalsRow, topTypes: Array<{ ext: string; count: string }>): DocumentSummaryResponse {
    return {
        image: { count: Number(row.image_count), bytes: Number(row.image_bytes) },
        video: { count: Number(row.video_count), bytes: Number(row.video_bytes) },
        file: {
            count: Number(row.file_count),
            bytes: Number(row.file_bytes),
            top_types: topTypes.map((type) => ({ ext: type.ext, count: Number(type.count) })),
        },
    };
}

const COVER_TILES = 4;

/** Documents with a rendered thumbnail (a non-blank blurhash) rank ahead of those without. */
const HAS_THUMBNAIL_SQL = sql<boolean>`btrim(coalesce(thumbnail_blurhash, '')) <> ''`;

const EMPTY_TOTALS: TotalsRow = { image_count: '0', image_bytes: '0', video_count: '0', video_bytes: '0', file_count: '0', file_bytes: '0' };

type CoverFilters = Omit<DocumentListFilters, 'kind'>;

/**
 * The covers of the given folders, in a fixed number of queries (tiles, totals, top types) whatever their number.
 * Each folder's own live documents only. The caller has dropped locked folders from [folderIds], so the private
 * filter is off here, and so is the route's list of ids: it never passes a private folder, open or not. The rules are those of summariseDocuments.
 */
export async function loadFolderCovers(userId: string, folderIds: string[]): Promise<Map<string, FolderCover>> {
    if (folderIds.length === 0) return new Map();

    const filters: CoverFilters = { userId, privateFolderIds: [] };
    const [tileRows, totalRows, typeRows] = await Promise.all([
        loadCoverTiles(filters, folderIds),
        loadCoverTotals(filters, folderIds),
        loadCoverTypes(filters, folderIds),
    ]);
    const covers = new Map<string, FolderCover>();

    for (const folderId of folderIds) {
        const totals = totalRows.find((row) => row.folder_id === folderId);
        const types = typeRows.filter((row) => row.folder_id === folderId);
        const tiles = tileRows.filter((row) => row.folder_id === folderId).map(toTile);

        covers.set(folderId, { tiles, summary: toSummary(totals ?? EMPTY_TOTALS, types) });
    }

    return covers;
}

function loadCoverTiles(filters: CoverFilters, folderIds: string[]) {
    const ranked = applyDocumentListFilters(
        db
            .selectFrom('documents')
            .select(['folder_id', 'id', 'mime_type', 'original_filename', 'thumbnail_blurhash'])
            .select(sql<number>`row_number() over (partition by folder_id order by ${HAS_THUMBNAIL_SQL} desc, created_at desc, id desc)`.as('rank')),
        filters,
    ).where('folder_id', 'in', folderIds);

    return db.selectFrom(ranked.as('ranked')).selectAll().where('rank', '<=', COVER_TILES).orderBy('folder_id').orderBy('rank').execute();
}

function toTile(row: { id: string; mime_type: string; original_filename: string; thumbnail_blurhash: string | null }): FolderCoverTile {
    const blurhash = row.thumbnail_blurhash?.trim() ? row.thumbnail_blurhash : null;

    return { document_id: row.id, mime_type: row.mime_type, original_filename: row.original_filename, thumbnail_blurhash: blurhash };
}

function loadCoverTotals(filters: CoverFilters, folderIds: string[]) {
    return applyDocumentListFilters(
        db.selectFrom('documents').select((eb) => [eb.ref('folder_id').as('folder_id'), ...KINDS.flatMap((kind) => totalsOf(eb, kind))]),
        filters,
    )
        .where('folder_id', 'in', folderIds)
        .groupBy('folder_id')
        .execute();
}

function loadCoverTypes(filters: CoverFilters, folderIds: string[]) {
    const counted = applyDocumentListFilters(
        db.selectFrom('documents').select(['folder_id', FILE_TYPE_SQL.as('ext'), (eb) => eb.fn.countAll<string>().as('count')]),
        { ...filters, kind: 'file' },
    )
        .where('folder_id', 'in', folderIds)
        .where(FILE_TYPE_SQL, '<>', '')
        .groupBy(['folder_id', 'ext'])
        .select(sql<number>`row_number() over (partition by folder_id order by count(*) desc, ${FILE_TYPE_SQL})`.as('rank'));

    return db.selectFrom(counted.as('counted')).selectAll().where('rank', '<=', TOP_TYPES).orderBy('folder_id').orderBy('rank').execute();
}
