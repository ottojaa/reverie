import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import { buildPrefixTsQuery } from './query-builder';

/**
 * Snippet/Highlight Generator for Search Results
 *
 * Uses PostgreSQL ts_headline for context-aware highlighting of search terms.
 * Uses 'simple' config for ts_headline - better word boundaries for OCR/dense text
 * (numbers, concatenations) where 'english' can miscount and produce huge fragments.
 */

export interface SnippetOptions {
    maxWords?: number;
    minWords?: number;
    startTag?: string;
    stopTag?: string;
    maxFragments?: number;
    maxChars?: number;
}

const DEFAULT_OPTIONS = {
    maxWords: 35,
    minWords: 15,
    startTag: '<mark>',
    stopTag: '</mark>',
    maxFragments: 2,
    maxChars: 120,
};

/**
 * Normalize snippet for single-line display: collapse newlines to spaces.
 * OCR output often has line breaks that aren't word boundaries, causing overflow.
 */
function normalizeForSingleLine(snippet: string): string {
    return snippet.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');
}

/**
 * Truncate snippet to maxChars. Puts the first <mark> near the start so it stays
 * visible when UI truncates from the right (single-line overflow).
 */
function truncateSnippet(snippet: string, maxChars: number): string {
    if (snippet.length <= maxChars) {
        return snippet;
    }

    const markStart = snippet.indexOf('<mark>');

    if (markStart === -1) {
        return snippet.slice(0, maxChars - 3) + '...';
    }

    // Keep match in first ~40% so it's visible when UI truncates
    const contextBefore = Math.min(30, Math.floor(maxChars * 0.35));
    const start = Math.max(0, markStart - contextBefore);
    const end = Math.min(snippet.length, start + maxChars);

    const result = (start > 0 ? '...' : '') + snippet.slice(start, end) + (end < snippet.length ? '...' : '');

    return result;
}

/**
 * Generate a highlighted snippet for a single document
 */
export async function generateSnippet(documentId: string, searchTerms: string, options: SnippetOptions = {}): Promise<string | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const tsQuery = buildPrefixTsQuery(searchTerms);
    const headlineOptions = `StartSel=${opts.startTag}, StopSel=${opts.stopTag}, MaxWords=${opts.maxWords}, MinWords=${opts.minWords}, MaxFragments=${opts.maxFragments}`;

    const result = await db
        .selectFrom('ocr_results')
        .select(sql<string>`ts_headline('simple', raw_text, ${tsQuery}, ${sql.lit(headlineOptions)})`.as('snippet'))
        .where('document_id', '=', documentId)
        .where(sql<SqlBool>`text_vector @@ ${tsQuery}`)
        .executeTakeFirst();

    const raw = result?.snippet ?? null;

    if (!raw) return null;

    const snippet = normalizeForSingleLine(raw);
    const maxChars = opts.maxChars ?? DEFAULT_OPTIONS.maxChars;

    return maxChars ? truncateSnippet(snippet, maxChars) : snippet;
}

/**
 * Generate snippets for multiple documents in a single query
 */
export async function generateSnippets(documentIds: string[], searchTerms: string, options: SnippetOptions = {}): Promise<Map<string, string>> {
    if (documentIds.length === 0 || !searchTerms.trim()) {
        return new Map();
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };

    const tsQuery = buildPrefixTsQuery(searchTerms);
    const headlineOptions = `StartSel=${opts.startTag}, StopSel=${opts.stopTag}, MaxWords=${opts.maxWords}, MinWords=${opts.minWords}, MaxFragments=${opts.maxFragments}`;

    const results = await db
        .selectFrom('ocr_results')
        .select(['document_id', sql<string>`ts_headline('simple', raw_text, ${tsQuery}, ${sql.lit(headlineOptions)})`.as('snippet')])
        .where('document_id', 'in', documentIds)
        .where(sql<SqlBool>`text_vector @@ ${tsQuery}`)
        .execute();

    const snippetMap = new Map<string, string>();
    const maxChars = opts.maxChars ?? DEFAULT_OPTIONS.maxChars;

    for (const row of results) {
        const normalized = normalizeForSingleLine(row.snippet);
        const snippet = maxChars ? truncateSnippet(normalized, maxChars) : normalized;
        snippetMap.set(row.document_id, snippet);
    }

    return snippetMap;
}

/**
 * Generate a filename-based snippet when content doesn't match
 */
export function generateFilenameSnippet(filename: string, searchTerms?: string): string | null {
    if (!searchTerms) {
        return null;
    }

    // Simple highlighting for filename matches
    const terms = searchTerms.toLowerCase().split(/\s+/).filter(Boolean);
    let highlighted = filename;

    for (const term of terms) {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }

    return highlighted;
}

/**
 * Generate a summary-based snippet
 */
export function generateSummarySnippet(summary: string, searchTerms: string, maxLength = 200): string {
    const terms = searchTerms.toLowerCase().split(/\s+/).filter(Boolean);

    // Find the first occurrence of any search term
    let bestStart = 0;

    for (const term of terms) {
        const index = summary.toLowerCase().indexOf(term);

        if (index !== -1 && (bestStart === 0 || index < bestStart)) {
            bestStart = Math.max(0, index - 50);
        }
    }

    // Extract context around the term
    let snippet = summary.slice(bestStart, bestStart + maxLength);

    // Clean up start/end
    if (bestStart > 0) {
        const spaceIndex = snippet.indexOf(' ');

        if (spaceIndex > 0 && spaceIndex < 20) {
            snippet = '...' + snippet.slice(spaceIndex + 1);
        } else {
            snippet = '...' + snippet;
        }
    }

    if (bestStart + maxLength < summary.length) {
        const lastSpaceIndex = snippet.lastIndexOf(' ');

        if (lastSpaceIndex > snippet.length - 30) {
            snippet = snippet.slice(0, lastSpaceIndex) + '...';
        } else {
            snippet = snippet + '...';
        }
    }

    // Highlight terms
    for (const term of terms) {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        snippet = snippet.replace(regex, '<mark>$1</mark>');
    }

    return snippet;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip HTML tags from snippet (for plain text display)
 */
export function stripHighlights(snippet: string): string {
    return snippet.replace(/<\/?mark>/g, '');
}

/**
 * Get highlighted positions from a snippet (for custom rendering)
 */
export function getHighlightPositions(snippet: string): Array<{ start: number; end: number }> {
    const positions: Array<{ start: number; end: number }> = [];
    const regex = /<mark>(.*?)<\/mark>/g;

    let match;

    while ((match = regex.exec(snippet)) !== null) {
        // Calculate position in plain text
        const beforeMatch = snippet.slice(0, match.index).replace(/<\/?mark>/g, '');
        const start = beforeMatch.length;
        const matchedText = match[1] ?? '';
        const end = start + matchedText.length;

        positions.push({ start, end });
    }

    return positions;
}
