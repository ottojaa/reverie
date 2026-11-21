import type { DocumentSearchResult, ParsedQuery } from '@reverie/shared';
import { sql } from 'kysely';
import { db } from '../db/kysely';
import { excludeTrashed } from '../services/privacy';
import { getStorageService } from '../services/storage.service';
import { formatDateOnly } from '../utils/date';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { buildPrefixTsQuery, documentJoins } from './filter-application';
import { generateFilenameSnippet, generateSnippets, generateSummarySnippet } from './highlighter';

/** Turns document ids into full search results: snippets, tags, thumbnails and a display name. */

interface DocumentRow {
    id: string;
    original_filename: string;
    folder_id: string | null;
    created_at: Date;
    extracted_date: Date | null;
    document_category: string | null;
    mime_type: string;
    size_bytes: number | string;
    duration_seconds: number | null;
    has_meaningful_text: boolean;
    thumbnail_paths: unknown;
    thumbnail_blurhash: string | null;
    llm_summary: string | null;
    llm_title: string | null;
    llm_processing_type: string | null;
    folder_path: string | null;
    raw_text: string | null;
    photo_city: string | null;
    photo_country: string | null;
    photo_taken_at: Date | null;
    relevance?: number | null;
}

/** Hydrate full document results for a set of ids, keyed by id. */
export async function fetchDocumentDetails(userId: string, ids: string[], parsed: ParsedQuery): Promise<Map<string, DocumentSearchResult>> {
    if (ids.length === 0) return new Map();

    const base = excludeTrashed(documentJoins().where('d.user_id', '=', userId).where('d.id', 'in', ids), 'd.').select([
        'd.id',
        'd.original_filename',
        'd.folder_id',
        'd.created_at',
        'd.extracted_date',
        'd.document_category',
        'd.mime_type',
        'd.size_bytes',
        'd.duration_seconds',
        'd.has_meaningful_text',
        'd.thumbnail_paths',
        'd.thumbnail_blurhash',
        'llm.summary as llm_summary',
        sql<string | null>`llm.metadata->>'title'`.as('llm_title'),
        sql<string | null>`llm.metadata->>'type'`.as('llm_processing_type'),
        'f.path as folder_path',
        'ocr.raw_text',
        'pm.city as photo_city',
        'pm.country as photo_country',
        'pm.taken_at as photo_taken_at',
    ]);

    const tsQuery = parsed.fullText ? buildPrefixTsQuery(parsed.fullText) : null;
    const query = tsQuery ? base.select(sql<number>`COALESCE(ts_rank(d.search_vector, ${tsQuery}), 0)`.as('relevance')) : base;

    const rows = (await query.execute()) as unknown as DocumentRow[];
    const enriched = await enrichDocumentRows(rows, parsed);

    return new Map(enriched.map((r) => [r.document_id, r]));
}

/** Transform raw document rows into DocumentSearchResults (snippets, tags, thumbnails, display name). */
async function enrichDocumentRows(rows: DocumentRow[], parsed: ParsedQuery): Promise<DocumentSearchResult[]> {
    const documentIds = rows.map((row) => row.id);

    let snippetMap = new Map<string, string>();

    if (parsed.fullText && documentIds.length > 0) {
        snippetMap = await generateSnippets(documentIds, parsed.fullText);
    }

    const tagRows =
        documentIds.length > 0 ? await db.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', documentIds).execute() : [];

    const tagMap = new Map<string, string[]>();

    for (const row of tagRows) {
        const tags = tagMap.get(row.document_id) ?? [];

        tags.push(row.tag);
        tagMap.set(row.document_id, tags);
    }

    const storageService = getStorageService();

    return Promise.all(
        rows.map(async (row) => {
            let snippet: string | null = null;

            if (parsed.fullText) {
                snippet = snippetMap.get(row.id) ?? null;

                if (!snippet && row.llm_summary) {
                    snippet = generateSummarySnippet(row.llm_summary, parsed.fullText);
                }

                if (!snippet) {
                    snippet = generateFilenameSnippet(row.original_filename, parsed.fullText);
                }
            }

            const format = mimeToExtension(row.mime_type);
            const thumbnailPaths = row.thumbnail_paths as { sm: string; md: string; lg: string } | null;
            const thumbnailUrls = await resolveThumbnailUrls(storageService, thumbnailPaths);
            const displayName = computeDisplayName(row);

            return {
                result_type: 'document' as const,
                document_id: row.id,
                display_name: displayName,
                filename: row.original_filename,
                folder_path: row.folder_path,
                folder_id: row.folder_id,
                uploaded_at: row.created_at.toISOString(),
                extracted_date: formatDateOnly(row.extracted_date),
                category: row.document_category as DocumentSearchResult['category'],
                mime_type: row.mime_type,
                format,
                snippet,
                has_text: row.has_meaningful_text,
                thumbnail_urls: thumbnailUrls,
                blurhash: row.thumbnail_blurhash,
                size_bytes: Number(row.size_bytes),
                duration_seconds: row.duration_seconds,
                tags: tagMap.get(row.id) ?? [],
                relevance: row.relevance ?? null,
            };
        }),
    );
}

/**
 * Compute a human-readable display name for a search result.
 *
 * Priority cascade:
 * 1. LLM-generated title (text_summary processing)
 * 2. EXIF location + date (photo_metadata)
 * 3. Vision description truncated to first sentence
 * 4. Category-based fallback with date
 * 5. Original filename
 */
function computeDisplayName(row: {
    original_filename: string;
    document_category: string | null;
    extracted_date: Date | null;
    llm_title: string | null;
    llm_summary: string | null;
    llm_processing_type: string | null;
    photo_city: string | null;
    photo_country: string | null;
    photo_taken_at: Date | null;
}): string {
    // 1. LLM title for text-processed documents
    if (row.llm_title && row.llm_processing_type === 'text_summary') {
        return row.llm_title;
    }

    // 2. EXIF location + date for photos
    const isPhoto = row.document_category === 'photo' || row.document_category === 'screenshot' || row.document_category === 'graphic';

    if (isPhoto && (row.photo_city || row.photo_country)) {
        const location = row.photo_city ?? row.photo_country;
        const date = row.photo_taken_at ?? row.extracted_date;

        if (date) {
            return `Photo in ${location}, ${formatShortDate(date)}`;
        }

        return `Photo in ${location}`;
    }

    if (isPhoto && (row.photo_taken_at || row.extracted_date)) {
        const date = row.photo_taken_at ?? row.extracted_date!;

        return `Photo, ${formatShortDate(date)}`;
    }

    // 3. Vision description (first sentence)
    if (row.llm_summary && row.llm_processing_type === 'vision_describe') {
        const firstSentence = row.llm_summary.split(/[.!?]\s/)[0];

        if (firstSentence && firstSentence.length <= 60) {
            return firstSentence;
        }

        if (firstSentence) {
            return firstSentence.slice(0, 57) + '...';
        }
    }

    // 4. Category-based fallback
    const categoryLabels: Record<string, string> = {
        screenshot: 'Screenshot',
        receipt: 'Receipt',
        invoice: 'Invoice',
    };

    const categoryLabel = row.document_category ? categoryLabels[row.document_category] : undefined;

    if (categoryLabel) {
        const date = row.extracted_date ?? row.photo_taken_at;

        if (date) {
            return `${categoryLabel}, ${formatShortDate(date)}`;
        }

        return categoryLabel;
    }

    // 5. Original filename
    return row.original_filename;
}

function formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Convert MIME type to file extension
 */
function mimeToExtension(mimeType: string): string {
    const mapping: Record<string, string> = {
        'application/pdf': 'pdf',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/tiff': 'tiff',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
        'text/plain': 'txt',
    };

    return mapping[mimeType] || mimeType.split('/').pop() || 'unknown';
}
