import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { applySearchFilters, documentJoins } from '../search';
import { isPhotoSql, shownDateSql } from './photo';
import { defineTool } from './types';
import { loadVisibility, type Visibility } from './visibility';

const TOP_LIMIT = 20;

interface Count {
    name: string;
    count: number;
}

/** Document type as the rows show it: `photo` only for camera photos, otherwise the classifier category. */
const typeExpr = sql<string>`(CASE WHEN ${isPhotoSql()} THEN 'photo' ELSE coalesce(d.document_category, 'other') END)`;
const yearExpr = sql<string>`coalesce(extract(year FROM ${shownDateSql()})::text, 'unknown')`;
const placeExpr = sql<string>`coalesce(nullif(concat_ws(', ', pm.city, pm.country), ''), 'none')`;
const folderExpr = sql<string>`coalesce(f.path, 'none')`;

async function countBy(vis: Visibility, expr: RawBuilder<string>, limit: number): Promise<Count[]> {
    const rows = await applySearchFilters(documentJoins(), {}, vis.userId, vis.privateFolderIds)
        .select([expr.as('name'), sql<number>`count(*)`.as('count')])
        .groupBy(sql`1`)
        .orderBy(sql`2`, 'desc')
        .orderBy(sql`1`)
        .limit(limit)
        .execute();

    return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

export const getLibraryOverview = defineTool({
    name: 'get_library_overview',
    description: 'How many documents the library holds, counted by category, year, place and folder (the 20 largest places and folders).',
    access: 'read',
    inputSchema: z.object({}),
    handler: async (_input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const [by_category, by_year, by_place, by_folder] = await Promise.all([
            countBy(vis, typeExpr, 100),
            countBy(vis, yearExpr, 100),
            countBy(vis, placeExpr, TOP_LIMIT),
            countBy(vis, folderExpr, TOP_LIMIT),
        ]);

        return { total: by_category.reduce((sum, entry) => sum + entry.count, 0), by_category, by_year, by_place, by_folder };
    },
});
