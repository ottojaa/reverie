import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely';
import type { Folder } from '../db/schema';
import { buildSearchQuery, documentJoins } from '../search';
import { DOCUMENT_ROW_COLUMNS, loadTags, toDocumentRow } from './document-output';
import { defineTool } from './types';
import { fetchVisibleFolder, loadVisibility, visibleDocuments, visibleFolders, type Visibility } from './visibility';

const MAX_PAGE_SIZE = 100;

interface FolderSummary {
    id: string;
    name: string;
    path: string;
    type: 'collection' | 'folder';
    description?: string;
    documents: number;
}

/** Visible document counts per folder id (`null` key: documents not in any folder). */
async function loadDocumentCounts(vis: Visibility): Promise<Map<string | null, number>> {
    const rows = await visibleDocuments(db, vis)
        .select(['documents.folder_id', sql<number>`count(*)`.as('count')])
        .groupBy('documents.folder_id')
        .execute();

    return new Map(rows.map((row) => [row.folder_id, Number(row.count)]));
}

function toFolderSummary(folder: Folder, counts: Map<string | null, number>): FolderSummary {
    const summary: FolderSummary = { id: folder.id, name: folder.name, path: folder.path, type: folder.type, documents: counts.get(folder.id) ?? 0 };

    return folder.description ? { ...summary, description: folder.description } : summary;
}

export const listFolders = defineTool({
    name: 'list_folders',
    description: 'The library as collections with the folders in each, with how many documents each holds.',
    access: 'read',
    inputSchema: z.object({}),
    handler: async (_input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const [folders, counts] = await Promise.all([
            visibleFolders(db, vis).selectAll('folders').orderBy('folders.sort_order').orderBy('folders.name').execute(),
            loadDocumentCounts(vis),
        ]);
        const collections = folders
            .filter((folder) => folder.parent_id === null)
            .map((collection) => ({
                ...toFolderSummary(collection, counts),
                folders: folders.filter((folder) => folder.parent_id === collection.id).map((folder) => toFolderSummary(folder, counts)),
            }));

        return { collections, unfiled_documents: counts.get(null) ?? 0 };
    },
});

const listContentsSchema = z.object({
    folder_id: z
        .string()
        .uuid()
        .optional()
        .describe('The folder or collection to list. Leave out for the top level: every collection and the documents in no folder.'),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export const listFolderContents = defineTool({
    name: 'list_folder_contents',
    description: 'The sub-folders and one page of the documents directly inside a folder (or at the top level when folder_id is left out).',
    access: 'read',
    inputSchema: listContentsSchema,
    handler: async (input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const folder = input.folder_id ? await fetchVisibleFolder(vis, input.folder_id) : null;
        const counts = await loadDocumentCounts(vis);
        const children = await visibleFolders(db, vis)
            .selectAll('folders')
            .where('folders.parent_id', folder ? '=' : 'is', folder?.id ?? null)
            .orderBy('folders.sort_order')
            .orderBy('folders.name')
            .execute();
        // buildSearchQuery adds the user scope and the locked/trashed exclusion on top of this folder filter.
        const page = await buildSearchQuery(
            documentJoins().where('d.folder_id', folder ? '=' : 'is', folder?.id ?? null),
            {},
            vis.userId,
            { limit: input.limit, offset: input.offset, sortBy: 'filename', sortOrder: 'asc' },
            vis.privateFolderIds,
        )
            .select(DOCUMENT_ROW_COLUMNS)
            .execute();
        const tags = await loadTags(page.map((row) => row.id));

        return {
            folder: folder ? toFolderSummary(folder, counts) : null,
            folders: children.map((child) => toFolderSummary(child, counts)),
            total_documents: counts.get(folder?.id ?? null) ?? 0,
            offset: input.offset,
            documents: page.map((row) => toDocumentRow(row, tags.get(row.id) ?? [])),
        };
    },
});
