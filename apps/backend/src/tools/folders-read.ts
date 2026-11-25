import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely';
import type { Folder } from '../db/schema';
import { buildSearchQuery, documentJoins } from '../search';
import { toFolderTree, type FolderTree } from '../services/folders/snapshot';
import { DOCUMENT_ROW_COLUMNS, loadTags, toDocumentRow } from './document-output';
import { defineTool, ToolError } from './types';
import { loadVisibility, visibleDocuments, visibleFolders, type Visibility } from './visibility';

const MAX_PAGE_SIZE = 100;

interface FolderSummary {
    id: string;
    name: string;
    path: string;
    description?: string;
    /** Documents directly in the folder. */
    documents: number;
    /** Documents in the folder and in every folder beneath it. */
    subtree_documents: number;
}

interface FolderNodeSummary extends FolderSummary {
    folders: FolderNodeSummary[];
}

/** The folders the agent may see, as a tree, with the visible documents directly in each (`null` key: in no folder). */
interface VisibleLibrary {
    tree: FolderTree<Folder>;
    counts: Map<string | null, number>;
}

async function loadDocumentCounts(vis: Visibility): Promise<Map<string | null, number>> {
    const rows = await visibleDocuments(db, vis)
        .select(['documents.folder_id', sql<number>`count(*)`.as('count')])
        .groupBy('documents.folder_id')
        .execute();

    return new Map(rows.map((row) => [row.folder_id, Number(row.count)]));
}

async function loadVisibleLibrary(vis: Visibility): Promise<VisibleLibrary> {
    const [folders, counts] = await Promise.all([visibleFolders(db, vis).selectAll('folders').execute(), loadDocumentCounts(vis)]);

    return { tree: toFolderTree(folders), counts };
}

function toFolderSummary(folder: Folder, { tree, counts }: VisibleLibrary): FolderSummary {
    const summary: FolderSummary = {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        documents: counts.get(folder.id) ?? 0,
        subtree_documents: tree.subtree(folder.id).reduce((sum, inside) => sum + (counts.get(inside.id) ?? 0), 0),
    };

    return folder.description ? { ...summary, description: folder.description } : summary;
}

function toFolderNode(folder: Folder, library: VisibleLibrary): FolderNodeSummary {
    return { ...toFolderSummary(folder, library), folders: library.tree.children(folder.id).map((child) => toFolderNode(child, library)) };
}

export const listFolders = defineTool({
    name: 'list_folders',
    description:
        'All folders as a tree, nested to any depth. Each says how many documents it holds directly (documents) and including the folders beneath it (subtree_documents).',
    access: 'read',
    inputSchema: z.object({}),
    handler: async (_input, ctx) => {
        const library = await loadVisibleLibrary(await loadVisibility(ctx.user.id));

        return {
            folders: library.tree.children(null).map((folder) => toFolderNode(folder, library)),
            unfiled_documents: library.counts.get(null) ?? 0,
        };
    },
});

const listContentsSchema = z.object({
    folder_id: z.string().uuid().optional().describe('The folder to list. Leave out for the top level: the top folders and the documents in no folder.'),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export const listFolderContents = defineTool({
    name: 'list_folder_contents',
    description:
        'The sub-folders and one page of the documents directly inside a folder (or at the top level when folder_id is left out), with the folders above it from the top down (breadcrumb).',
    access: 'read',
    inputSchema: listContentsSchema,
    handler: async (input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const library = await loadVisibleLibrary(vis);
        const folder = input.folder_id ? library.tree.folder(input.folder_id) : null;

        // Locked, trashed and unknown folders are all simply absent from the visible tree.
        if (folder === undefined) throw new ToolError('Folder not found: ' + input.folder_id);

        const folderId = folder?.id ?? null;
        // buildSearchQuery adds the user scope and the locked/trashed exclusion on top of this folder filter.
        const page = await buildSearchQuery(
            documentJoins().where('d.folder_id', folderId === null ? 'is' : '=', folderId),
            {},
            vis.userId,
            { limit: input.limit, offset: input.offset, sortBy: 'filename', sortOrder: 'asc' },
            vis.privateFolderIds,
        )
            .select(DOCUMENT_ROW_COLUMNS)
            .execute();
        const tags = await loadTags(page.map((row) => row.id));

        return {
            folder: folder ? toFolderSummary(folder, library) : null,
            breadcrumb: folder ? library.tree.ancestors(folder.id).map(({ id, name }) => ({ id, name })) : [],
            folders: library.tree.children(folderId).map((child) => toFolderSummary(child, library)),
            total_documents: library.counts.get(folderId) ?? 0,
            offset: input.offset,
            documents: page.map((row) => toDocumentRow(row, tags.get(row.id) ?? [])),
        };
    },
});
