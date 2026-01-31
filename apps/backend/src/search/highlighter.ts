import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';

/**
 * Snippet/Highlight Generator for Search Results
 *
 * Uses PostgreSQL ts_headline for context-aware highlighting of search terms.
 */

export interface SnippetOptions {
    maxWords?: number;
    minWords?: number;
    startTag?: string;
    stopTag?: string;
    maxFragments?: number;
}

const DEFAULT_OPTIONS: Required<SnippetOptions> = {
    maxWords: 50,
    minWords: 25,
    startTag: '<mark>',
    stopTag: '</mark>',
    maxFragments: 3,
};

/**
 * Generate a highlighted snippet for a single document
 */
export async function generateSnippet(documentId: string, searchTerms: string, options: SnippetOptions = {}): Promise<string | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const tsQuery = sql`plainto_tsquery('english', ${searchTerms})`;
    const headlineOptions = `StartSel=${opts.startTag}, StopSel=${opts.stopTag}, MaxWords=${opts.maxWords}, MinWords=${opts.minWords}, MaxFragments=${opts.maxFragments}`;

    const result = await db
        .selectFrom('ocr_results')
        .select(sql<string>`ts_headline('english', raw_text, ${tsQuery}, ${sql.lit(headlineOptions)})`.as('snippet'))
        .where('document_id', '=', documentId)
        .where(sql<SqlBool>`text_vector @@ ${tsQuery}`)
        .executeTakeFirst();

    return result?.snippet ?? null;
}

/**
 * Generate snippets for multiple documents in a single query
 */
export async function generateSnippets(documentIds: string[], searchTerms: string, options: SnippetOptions = {}): Promise<Map<string, string>> {
    if (documentIds.length === 0 || !searchTerms.trim()) {
        return new Map();
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };

    const tsQuery = sql`plainto_tsquery('english', ${searchTerms})`;
    const headlineOptions = `StartSel=${opts.startTag}, StopSel=${opts.stopTag}, MaxWords=${opts.maxWords}, MinWords=${opts.minWords}, MaxFragments=${opts.maxFragments}`;

    const results = await db
        .selectFrom('ocr_results')
        .select(['document_id', sql<string>`ts_headline('english', raw_text, ${tsQuery}, ${sql.lit(headlineOptions)})`.as('snippet')])
        .where('document_id', 'in', documentIds)
        .where(sql<SqlBool>`text_vector @@ ${tsQuery}`)
        .execute();

    const snippetMap = new Map<string, string>();
    for (const row of results) {
        snippetMap.set(row.document_id, row.snippet);
    }

    return snippetMap;
}

/**
 * Generate a filename-based snippet when content doesn't match
 */
export function generateFilenameSnippet(folderPath: string | null, filename: string, searchTerms?: string): string {
    const fullPath = folderPath ? `${folderPath}/${filename}` : filename;

    if (!searchTerms) {
        return fullPath;
    }

    // Simple highlighting for filename matches
    const terms = searchTerms.toLowerCase().split(/\s+/).filter(Boolean);
    let highlighted = fullPath;

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
