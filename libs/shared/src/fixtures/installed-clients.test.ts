import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Apps already installed keep reading the folder tree after the server learns to nest folders. These are the
 * shapes they were built with, written out here so that changes to the current schemas cannot move them.
 */
const tree: unknown = JSON.parse(readFileSync(new URL('./folder-tree.json', import.meta.url), 'utf8'));

const folderFields = {
    id: z.string().uuid(),
    name: z.string(),
    path: z.string(),
    type: z.enum(['collection', 'folder']),
    is_private: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
};

/** The web app's FolderTreeResponseSchema: every field required, null only where it says so. */
function toWebTreeSchema() {
    const total = z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() });
    const topType = z.object({ ext: z.string(), count: z.number().int().positive() });
    const cover = z.object({
        tiles: z
            .array(
                z.object({
                    document_id: z.string().uuid(),
                    mime_type: z.string(),
                    original_filename: z.string(),
                    thumbnail_blurhash: z.string().nullable(),
                }),
            )
            .max(4),
        summary: z.object({ image: total, video: total, file: total.extend({ top_types: z.array(topType).max(4) }) }),
    });
    const node: z.ZodTypeAny = z.object({
        ...folderFields,
        parent_id: z.string().uuid().nullable(),
        name: z.string().min(1).max(255),
        description: z.string().nullable(),
        emoji: z.string().max(48).nullable(),
        sort_order: z.number(),
        locked: z.boolean(),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        children: z.lazy(() => z.array(node)),
        document_count: z.number(),
        cover: cover.nullable(),
    });

    return z.array(node);
}

/**
 * The Android app's FolderWithChildren: unknown keys are ignored, a property with a default may be missing, and
 * only a nullable property may be null.
 */
function toAndroidTreeSchema() {
    const total = { count: z.number().int().optional(), bytes: z.number().int().optional() };
    const cover = z.object({
        tiles: z
            .array(
                z.object({
                    document_id: z.string(),
                    mime_type: z.string(),
                    original_filename: z.string(),
                    thumbnail_blurhash: z.string().nullish(),
                }),
            )
            .optional(),
        summary: z
            .object({
                image: z.object(total).optional(),
                video: z.object(total).optional(),
                file: z.object({ ...total, top_types: z.array(z.object({ ext: z.string(), count: z.number().int() })).optional() }).optional(),
            })
            .optional(),
    });
    const node: z.ZodTypeAny = z.object({
        ...folderFields,
        id: z.string(),
        parent_id: z.string().nullish(),
        description: z.string().nullish(),
        emoji: z.string().nullish(),
        sort_order: z.number().int(),
        locked: z.boolean().optional(),
        children: z.lazy(() => z.array(node)).optional(),
        document_count: z.number().int().optional(),
        cover: cover.nullish(),
    });

    return z.array(node);
}

describe('installed clients read the nested folder tree', () => {
    it.each([
        ['web', toWebTreeSchema()],
        ['Android', toAndroidTreeSchema()],
    ])('%s parses it, three levels deep', (_client, schema) => {
        const parsed = schema.parse(tree) as Array<{ children: Array<{ children: Array<{ name: string }> }> }>;
        const names = parsed.flatMap((top) => (top.children ?? []).flatMap((second) => (second.children ?? []).map((third) => third.name)));

        expect(names).toContain('Norway');
    });
});
