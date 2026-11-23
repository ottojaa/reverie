import type { DocumentKind } from '@reverie/shared';
import { sql, type ExpressionBuilder, type SelectQueryBuilder } from 'kysely';
import type { Database, JobStatus } from '../db/schema';
import { excludePrivateDocuments, excludeTrashed } from './privacy';

const RUNNING_STATUSES: JobStatus[] = ['pending', 'processing'];

export interface DocumentListFilters {
    userId: string;
    /** Set: that folder's documents (the caller has checked its lock). Unset: everything outside the private folders. */
    folderId?: string;
    privateFolderIds: string[];
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    processing?: boolean;
    kind?: DocumentKind;
}

/** A document whose text recognition, thumbnail or AI summary has not finished yet (transcoding is its own clock). */
function isStillProcessing(eb: ExpressionBuilder<Database, 'documents'>) {
    return eb.or([eb('ocr_status', 'in', RUNNING_STATUSES), eb('thumbnail_status', 'in', RUNNING_STATUSES), eb('llm_status', 'in', RUNNING_STATUSES)]);
}

/** documentKindOf in SQL: a case-insensitive MIME prefix; everything else is a file. mime_type is NOT NULL. */
function isOfKind(eb: ExpressionBuilder<Database, 'documents'>, kind: DocumentKind) {
    const isImage = eb(sql<string>`lower(mime_type)`, 'like', 'image/%');
    const isVideo = eb(sql<string>`lower(mime_type)`, 'like', 'video/%');

    if (kind === 'image') return isImage;
    if (kind === 'video') return isVideo;

    return eb.not(eb.or([isImage, isVideo]));
}

/**
 * Every rule that decides which documents the list (and its total) contains. The page query and the count query
 * both go through here, so they cannot disagree.
 */
export function applyDocumentListFilters<O>(query: SelectQueryBuilder<Database, 'documents', O>, filters: DocumentListFilters): SelectQueryBuilder<Database, 'documents', O> {
    const { userId, folderId, privateFolderIds, category, dateFrom, dateTo, processing, kind } = filters;

    let filtered = excludeTrashed(query.where('user_id', '=', userId), '');

    filtered = folderId ? filtered.where('folder_id', '=', folderId) : excludePrivateDocuments(filtered, privateFolderIds, '');

    if (category) filtered = filtered.where('document_category', '=', category);
    if (dateFrom) filtered = filtered.where('extracted_date', '>=', new Date(dateFrom));
    if (dateTo) filtered = filtered.where('extracted_date', '<=', new Date(dateTo));
    if (processing) filtered = filtered.where(isStillProcessing);
    if (kind) filtered = filtered.where((eb) => isOfKind(eb, kind));

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
