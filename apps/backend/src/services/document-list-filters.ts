import type { DocumentKind } from '@reverie/shared';
import { sql, type ExpressionBuilder, type SelectQueryBuilder } from 'kysely';
import type { Database, JobStatus } from '../db/schema';
import { excludePrivateDocuments, excludeTrashed } from './privacy';

const RUNNING_STATUSES: JobStatus[] = ['pending', 'processing'];

export interface DocumentListFilters {
    userId: string;
    /** Set: that folder's documents (the caller has checked its lock). Unset: everything outside the private folders. */
    folderId?: string;
    /** Only the documents in no folder. */
    topLevel?: boolean;
    privateFolderIds: string[];
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    processing?: boolean;
    kind?: DocumentKind;
    /** Photos and videos only. */
    media?: boolean;
}

/** A document whose text recognition, thumbnail or AI summary has not finished yet (transcoding is its own clock). */
function isStillProcessing(eb: ExpressionBuilder<Database, 'documents'>) {
    return eb.or([eb('ocr_status', 'in', RUNNING_STATUSES), eb('thumbnail_status', 'in', RUNNING_STATUSES), eb('llm_status', 'in', RUNNING_STATUSES)]);
}

/** The MIME type column, as a query names the documents table. */
type MimeTypeColumn = 'mime_type' | 'd.mime_type';

/** What makes a document an image or a video, as in documentKindOf: a case-insensitive MIME prefix. mime_type is NOT NULL. */
function hasKindPrefix(column: MimeTypeColumn, kind: 'image' | 'video') {
    return sql<boolean>`lower(${sql.ref(column)}) like ${sql.lit(kind + '/%')}`;
}

/** A photo or a video (the image and video kinds together). */
export function isMediaSql(column: MimeTypeColumn) {
    return sql<boolean>`(${hasKindPrefix(column, 'image')} or ${hasKindPrefix(column, 'video')})`;
}

/** documentKindOf in SQL; everything that is neither a photo nor a video is a file. */
export function isOfKind(eb: ExpressionBuilder<Database, 'documents'>, kind: DocumentKind) {
    if (kind === 'file') return eb.not(isMediaSql('mime_type'));

    return hasKindPrefix('mime_type', kind);
}

/**
 * Every rule that decides which documents the list (and its total) contains. The page query and the count query
 * both go through here, so they cannot disagree.
 */
export function applyDocumentListFilters<O>(
    query: SelectQueryBuilder<Database, 'documents', O>,
    filters: DocumentListFilters,
): SelectQueryBuilder<Database, 'documents', O> {
    const { userId, folderId, topLevel, privateFolderIds, category, dateFrom, dateTo, processing, kind, media } = filters;

    let filtered = excludeTrashed(query.where('user_id', '=', userId), '');

    filtered = folderId ? filtered.where('folder_id', '=', folderId) : excludePrivateDocuments(filtered, privateFolderIds, '');

    if (topLevel) filtered = filtered.where('folder_id', 'is', null);

    if (category) filtered = filtered.where('document_category', '=', category);

    if (dateFrom) filtered = filtered.where('extracted_date', '>=', new Date(dateFrom));

    if (dateTo) filtered = filtered.where('extracted_date', '<=', new Date(dateTo));

    if (processing) filtered = filtered.where(isStillProcessing);

    if (kind) filtered = filtered.where((eb) => isOfKind(eb, kind));

    if (media) filtered = filtered.where(isMediaSql('mime_type'));

    return filtered;
}

/**
 * When the document was taken (photo_metadata.taken_at, a local clock reading stored as if UTC), as a scalar
 * subquery: photo_metadata.document_id is unique, and a join would drag that table's own id into selectAll().
 * Null when there is none.
 */
export const TAKEN_AT_SQL = sql<Date | null>`(SELECT pm.taken_at FROM photo_metadata pm WHERE pm.document_id = documents.id)`;

/** The order of photos and videos: date taken, else upload date, newest first; id keeps offset paging stable. */
export const TAKEN_OR_CREATED_SQL = sql`coalesce(${TAKEN_AT_SQL}, documents.created_at)`;

/**
 * A screenshot or a screen recording, by its category or its filename (macOS, Android and iOS names). Such files
 * rank last wherever a few documents stand for many: folder covers and kind previews.
 */
export const IS_SCREEN_CAPTURE_SQL = sql<boolean>`(coalesce(documents.document_category, '') = 'screenshot'
    OR documents.original_filename ~* 'screen[ ._-]?(shot|capture|grab|recording)|^screen-[0-9]{8}|^rpreplay')`;
