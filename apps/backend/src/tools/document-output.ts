import { db } from '../db/kysely';
import { formatClockDate, formatDateOnly } from '../utils/date';
import { isPhoto, withholdsImageContent } from './photo';

/**
 * The only code that turns a document into tool output. Rows are built from an allowlist of
 * fields, never by stripping a fuller record, so a field added to a query cannot leak by accident.
 */

export const ROW_TAG_LIMIT = 5;

/** Columns every document query selects for a row (aliases: d documents, f folders, pm photo_metadata). */
export const DOCUMENT_ROW_COLUMNS = [
    'd.id',
    'd.original_filename',
    'd.mime_type',
    'd.document_category',
    'd.extracted_date',
    'f.path as folder_path',
    'd.camera_read_at as camera_read_at',
    'pm.taken_at as taken_at',
    'pm.latitude as latitude',
    'pm.longitude as longitude',
    'pm.camera_make as camera_make',
    'pm.camera_model as camera_model',
    'pm.lens_model as lens_model',
    'pm.city as city',
    'pm.country as country',
] as const;

export interface DocumentRowSource {
    id: string;
    original_filename: string;
    mime_type: string;
    document_category: string | null;
    extracted_date: Date | null;
    folder_path: string | null;
    camera_read_at: Date | null;
    taken_at: Date | null;
    latitude: number | null;
    longitude: number | null;
    camera_make: string | null;
    camera_model: string | null;
    lens_model: string | null;
    city: string | null;
    country: string | null;
}

export interface DocumentRow {
    id: string;
    filename: string;
    type: string;
    date: string | null;
    folder: string | null;
    place?: string;
    tags: string[];
}

export function toPlace(source: Pick<DocumentRowSource, 'city' | 'country'>): string | undefined {
    const place = [source.city, source.country].filter(Boolean).join(', ');

    return place === '' ? undefined : place;
}

/**
 * The date a document is shown with. An image whose content is withheld gets its capture date only:
 * its `extracted_date` is the model's reading of the picture.
 */
export function toDisplayDate(source: DocumentRowSource): string | null {
    const captured = formatClockDate(source.taken_at);

    if (withholdsImageContent(source)) return captured;

    return formatDateOnly(source.extracted_date) ?? captured;
}

export function toDocumentType(source: DocumentRowSource): string {
    if (isPhoto(source)) return 'photo';

    return source.document_category ?? 'other';
}

export function toDocumentRow(source: DocumentRowSource, tags: string[]): DocumentRow {
    const row: DocumentRow = {
        id: source.id,
        filename: source.original_filename,
        type: toDocumentType(source),
        date: toDisplayDate(source),
        folder: source.folder_path,
        tags: tags.slice(0, ROW_TAG_LIMIT),
    };
    const place = toPlace(source);

    return place === undefined ? row : { ...row, place };
}

/** Tags per document id (alphabetical, so the few a row shows are stable). */
export async function loadTags(ids: string[]): Promise<Map<string, string[]>> {
    const byId = new Map<string, string[]>();

    if (ids.length === 0) return byId;

    const rows = await db.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', ids).orderBy('tag').execute();

    for (const row of rows) byId.set(row.document_id, [...(byId.get(row.document_id) ?? []), row.tag]);

    return byId;
}
