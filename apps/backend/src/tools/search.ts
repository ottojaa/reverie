import { addFilter, replaceFilter, type ParsedQuery, type SortBy } from '@reverie/shared';
import { z } from 'zod';
import { buildCountQuery, buildSearchQuery, documentJoins, parseQuery, validateQuery } from '../search';
import { DOCUMENT_ROW_COLUMNS, loadTags, toDocumentRow, type DocumentRow } from './document-output';
import { applySearchGuard, withoutDateRange } from './search-guard';
import { createSelection, MAX_SELECTION_SIZE } from './selection.store';
import { defineTool, ToolError } from './types';
import { loadVisibility } from './visibility';

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
    folder: z.string().max(300).optional().describe('Folder path (starts with /) or part of a path'),
    folder_id: z.string().uuid().optional().describe('Only documents directly in this folder'),
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

    return input.folder_id ? { ...parsed, folderIds: [input.folder_id] } : parsed;
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

export const searchDocuments = defineTool({
    name: 'search_documents',
    description:
        'Keyword search over the library with filters. Returns one page of compact rows, the total, and a selection_id that stands for every match: pass it to a write tool instead of listing ids. Photos show filename, date, place and tags only.',
    access: 'read',
    inputSchema: searchSchema,
    handler: async (input, ctx) => {
        const parsed = toParsedQuery(input);
        const vis = await loadVisibility(ctx.user.id);
        const base = applySearchGuard(documentJoins(), parsed);
        const filters = withoutDateRange(parsed);
        const options = { limit: MAX_SELECTION_SIZE, offset: 0, sortBy: input.sort_by as SortBy, sortOrder: input.sort_order };
        const [matches, counted] = await Promise.all([
            buildSearchQuery(base, filters, vis.userId, options, vis.privateFolderIds).select('d.id').execute(),
            buildCountQuery(base, filters, vis.userId, vis.privateFolderIds).executeTakeFirstOrThrow(),
        ]);
        const ids = matches.map((match) => match.id);
        const rows = await loadRows(ids.slice(input.offset, input.offset + input.limit));

        return {
            total: counted.count,
            offset: input.offset,
            rows,
            selection_id: ids.length > 0 ? await createSelection(vis.userId, ids) : null,
            truncated: counted.count > ids.length,
        };
    },
});
