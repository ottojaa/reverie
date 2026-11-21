import { z } from 'zod';
import { pickBestCopy } from '../duplicates/best-copy';
import { loadDuplicateClusters } from '../duplicates/groups';
import { documentJoins, parseQuery } from '../search';
import { DOCUMENT_ROW_COLUMNS, toDocumentRow } from './document-output';
import { applySemanticGuard } from './search-guard';
import { defineTool } from './types';
import { loadVisibility } from './visibility';

const duplicatesSchema = z.object({
    limit: z.number().int().min(1).max(50).default(20).describe('Most groups to return, biggest first'),
});

const similarity = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Groups of images that are the same picture or nearly so, among the images the tools may show. It follows the rule of `similar_to`:
 * a photo whose content the tools withhold is never listed, because that two pictures look alike says something about what they show.
 * Groups are rebuilt without the withheld images, so a group left with one visible image is not listed.
 */
export const findDuplicates = defineTool({
    name: 'find_duplicates',
    description:
        'List groups of images that are the same picture or nearly so (burst shots, resized or re-compressed copies, an edited copy and its original, a screenshot taken twice), biggest first. Each group lists its images with filename, folder, size, resolution and date, and `suggested_keep_id`: the copy worth keeping (largest, then original over edited copy, then oldest). Read-only: this assistant cannot delete or move anything; the owner reviews groups in the Duplicates view. Photos show filename, date, folder and size only, and photos whose content the tools withhold are not listed.',
    access: 'read',
    inputSchema: duplicatesSchema,
    handler: async (input, ctx) => {
        const vis = await loadVisibility(ctx.user.id);
        const clusters = await loadDuplicateClusters({ userId: vis.userId, privateFolderIds: vis.privateFolderIds, lockFolderIds: null });
        const ids = clusters.flatMap((cluster) => cluster.ids);
        const rows =
            ids.length === 0
                ? []
                : await applySemanticGuard(documentJoins(), parseQuery(''))
                      .select([...DOCUMENT_ROW_COLUMNS, 'd.size_bytes', 'd.width', 'd.height', 'd.created_at'])
                      .where('d.id', 'in', ids)
                      .execute();
        const byId = new Map(rows.map((row) => [row.id, row]));
        const groups = clusters.flatMap((cluster) => {
            const members = cluster.ids.flatMap((id) => byId.get(id) ?? []);

            if (members.length < 2) return [];

            const suggested = pickBestCopy(
                members.map((row) => ({
                    id: row.id,
                    filename: row.original_filename,
                    width: row.width,
                    height: row.height,
                    date: row.taken_at ?? row.created_at,
                })),
            );

            return [
                {
                    suggested_keep_id: suggested,
                    min_similarity: similarity(cluster.minSimilarity),
                    images: members.map((row) => ({
                        ...toDocumentRow(row, []),
                        size_bytes: Number(row.size_bytes),
                        width: row.width,
                        height: row.height,
                    })),
                },
            ];
        });

        return { total: groups.length, groups: groups.slice(0, input.limit), truncated: groups.length > input.limit };
    },
});
