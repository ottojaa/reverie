import { addFilter, replaceFilter, type ParsedQuery, type SortBy } from '@reverie/shared';
import { z } from 'zod';
import { applySearchFilters, documentJoins, parseQuery, validateQuery } from '../search';
import { findRankedDocuments, type HybridContext } from '../search/hybrid-search';
import { findSimilarImages } from '../search/similar-images';
import { DOCUMENT_ROW_COLUMNS, loadTags, toDocumentRow, type DocumentRow } from './document-output';
import { applySearchGuard, applySemanticGuard, withoutDateRange } from './search-guard';
import { createSelection, MAX_SELECTION_SIZE } from './selection.store';
import { defineTool, ToolError } from './types';
import { loadVisibility, type Visibility } from './visibility';

const MAX_PAGE_SIZE = 100;

const searchSchema = z.object({
    query: z.string().max(500).default('').describe('Free text plus filters in the search syntax, e.g. `invoice tag:2024 -category:receipt date:2023-2024`'),
    types: z
        .array(z.enum(['photo', 'document', 'receipt', 'screenshot', 'video']))
        .optional()
        .describe(
            "Search's own type filter. 'photo' here is the classifier's label, so it also matches images without camera data; a row's `type` is 'photo' only for camera photos.",
        ),
    categories: z.array(z.string().min(1).max(60)).optional().describe('Document categories, e.g. receipt'),
    tags: z.array(z.string().min(1).max(60)).optional().describe('Every listed tag must be on the document'),
    formats: z.array(z.string().min(1).max(10)).optional().describe('File formats, e.g. pdf, jpg'),
    date: z.string().max(40).optional().describe('Document date: 2024, 2022-2024, 2024-01..2024-06, 2024-07-15 or last-month'),
    uploaded: z.string().max(40).optional().describe('Upload date, same forms as date'),
    location: z.string().max(100).optional().describe('City or country of a photo'),
    folder: z
        .string()
        .max(300)
        .optional()
        .describe('A folder by its whole path (starts with /) or its name, ignoring case. Includes everything beneath it.'),
    folder_id: z.string().uuid().optional().describe('Only documents in this folder and the folders beneath it'),
    similar_to: z
        .string()
        .uuid()
        .optional()
        .describe(
            'Id of an image: returns the images that look most like it, nearest first, instead of searching. Not combinable with `query`; the filters still apply. Photos whose content the tools withhold are neither sources nor results.',
        ),
    sort_by: z.enum(['relevance', 'uploaded', 'date', 'filename', 'size']).default('relevance'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    offset: z.number().int().min(0).default(0),
});

type SearchInput = z.infer<typeof searchSchema>;

/** The structured filters go into `q` through the shared token helpers, never by string concatenation. */
function toQueryString(input: SearchInput): string {
    let q = input.query;

    for (const type of input.types ?? []) q = addFilter(q, 'type', type);

    for (const category of input.categories ?? []) q = addFilter(q, 'category', category);

    for (const tag of input.tags ?? []) q = addFilter(q, 'tag', tag);

    for (const format of input.formats ?? []) q = addFilter(q, 'format', format);

    if (input.folder) q = addFilter(q, 'folder', input.folder);

    if (input.location) q = addFilter(q, 'location', input.location);

    if (input.date) q = replaceFilter(q, 'date', input.date);

    if (input.uploaded) q = replaceFilter(q, 'uploaded', input.uploaded);

    return q;
}

function isEmptyRange(range: ParsedQuery['uploadedRange']): boolean {
    return range !== undefined && !range.start && !range.end && !range.relative;
}

function toParsedQuery(input: SearchInput): ParsedQuery {
    const parsed = parseQuery(toQueryString(input));
    const errors = validateQuery(parsed);

    if (errors.length > 0) throw new ToolError('Invalid search: ' + errors[0]);

    if (isEmptyRange(parsed.extractedDateRange) || isEmptyRange(parsed.uploadedRange))
        throw new ToolError('Invalid date filter: use 2024, 2022-2024, 2024-01..2024-06, 2024-07-15 or last-month');

    return input.folder_id ? { ...parsed, scopeFolderId: input.folder_id } : parsed;
}

async function loadRows(ids: string[]): Promise<DocumentRow[]> {
    if (ids.length === 0) return [];

    const rows = await documentJoins().select(DOCUMENT_ROW_COLUMNS).where('d.id', 'in', ids).execute();
    const tags = await loadTags(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));

    return ids.flatMap((id) => {
        const row = byId.get(id);

        return row ? [toDocumentRow(row, tags.get(id) ?? [])] : [];
    });
}

/** The match flag on a row: why a document is in the results. Left out when meaning search wasn't used. */
function withMatch(rows: DocumentRow[], matches: Map<string, string | null>) {
    return rows.map((row) => {
        const match = matches.get(row.id);

        return match ? { ...row, match } : row;
    });
}

async function runSimilarImages(input: SearchInput, vis: Visibility) {
    if (input.query.trim()) throw new ToolError('Invalid search: similar_to cannot be combined with a query');

    const filters = toParsedQuery(input);
    const source = await applySearchFilters(applySemanticGuard(documentJoins(), parseQuery('')), parseQuery(''), vis.userId, vis.privateFolderIds)
        .where('d.id', '=', input.similar_to!)
        .select('d.id')
        .executeTakeFirst();

    if (!source) throw new ToolError('Image not found: ' + input.similar_to);

    const similar = await findSimilarImages(vis.userId, vis.privateFolderIds, input.similar_to!, {
        limit: input.limit,
        offset: input.offset,
        base: applySemanticGuard(documentJoins(), filters),
        filters: withoutDateRange(filters),
    });

    if (!similar) throw new ToolError('Image not analysed yet: ' + input.similar_to);

    const rows = await loadRows(similar.entries.map((entry) => entry.id));
    const similarity = new Map(similar.entries.map((entry) => [entry.id, Math.round(entry.similarity * 1000) / 1000]));

    return {
        total: similar.total,
        offset: input.offset,
        rows: rows.map((row) => ({ ...row, similarity: similarity.get(row.id) })),
        selection_id: null,
        selection_total: 0,
        truncated: similar.total > input.offset + rows.length,
    };
}

async function runSearch(input: SearchInput, vis: Visibility) {
    const parsed = toParsedQuery(input);
    const filters = withoutDateRange(parsed);
    const ctx: HybridContext = {
        userId: vis.userId,
        privateFolderIds: vis.privateFolderIds,
        fullTextBase: applySearchGuard(documentJoins(), parsed),
        semanticBase: applySemanticGuard(documentJoins(), parsed),
    };
    const options = { limit: MAX_SELECTION_SIZE, offset: 0, sortBy: input.sort_by as SortBy, sortOrder: input.sort_order };
    const ranked = await findRankedDocuments(filters, ctx, options);
    const page = ranked.entries.slice(input.offset, input.offset + input.limit);
    const rows = await loadRows(page.map((entry) => entry.id));
    // A selection stands for matches the agent can act on in bulk. Meaning-only matches are loose by nature, so they are
    // never swept into one: they are named by id (`document_ids`) after the agent has looked at them.
    const selected = ranked.entries.filter((entry) => entry.match !== 'meaning').map((entry) => entry.id);

    return {
        total: ranked.total,
        offset: input.offset,
        rows: withMatch(rows, new Map(page.map((entry) => [entry.id, entry.match]))),
        selection_id: selected.length > 0 ? await createSelection(vis.userId, selected) : null,
        selection_total: selected.length,
        truncated: ranked.total > ranked.entries.length,
    };
}

export const searchDocuments = defineTool({
    name: 'search_documents',
    description:
        "Search the library by words and by meaning, with filters. A document that matches the words ranks first; others join when they are close in meaning, and a row's `match` says which ('keywords', 'meaning' or 'both'). Returns one page of compact rows, the total, and a selection_id that stands for the keyword matches (selection_total of them): pass it to a write tool instead of listing ids. Meaning-only matches are left out of the selection, so name those by id. Set `similar_to` to an image id to find images that look like it (nearest first; later pages are approximate, so take what you need from the first page). Photos show filename, date, place and tags only.",
    access: 'read',
    inputSchema: searchSchema,
    handler: async (input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);

        return input.similar_to ? runSimilarImages(input, vis) : runSearch(input, vis);
    },
});
