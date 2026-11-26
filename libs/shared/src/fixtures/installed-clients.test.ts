import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * What the apps require of the server's answers: the web app as released with this server, and Android 1.0.28, which
 * stays installed while the server moves on. The shapes are written out here so that a change to the current schemas
 * cannot move them. A server change that fails here breaks an app.
 */
function fixture(name: string): unknown {
    return JSON.parse(readFileSync(new URL('./' + name, import.meta.url), 'utf8'));
}

/** zod strips unknown keys, as both apps ignore them. */
function toWebSchemas() {
    const id = z.string().uuid();
    const date = z.string().datetime();
    const text = z.string().nullable();
    const total = z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() });
    const topType = z.object({ ext: z.string(), count: z.number().int().positive() });
    const tile = z.object({ document_id: id, mime_type: z.string(), original_filename: z.string(), thumbnail_blurhash: text });
    const summary = z.object({ image: total, video: total, file: total.extend({ top_types: z.array(topType).max(4) }) });
    const node: z.ZodTypeAny = z.object({
        id,
        parent_id: id.nullable(),
        name: z.string().min(1).max(255),
        path: z.string(),
        description: text,
        emoji: z.string().max(48).nullable(),
        sort_order: z.number(),
        is_private: z.boolean(),
        lock_id: id.nullable(),
        locked: z.boolean(),
        created_at: date,
        updated_at: date,
        children: z.lazy(() => z.array(node)),
        kind_counts: z.object({ image: z.number().int(), video: z.number().int(), file: z.number().int() }),
        cover: z.object({ tiles: z.array(tile).max(4), summary }).nullable(),
    });
    const documentHit = z.object({
        result_type: z.literal('document'),
        document_id: id,
        display_name: z.string(),
        filename: z.string(),
        folder_path: text,
        folder_id: id.nullable(),
        uploaded_at: date,
        extracted_date: text,
        category: text,
        mime_type: z.string(),
        format: z.string(),
        snippet: text,
        has_text: z.boolean(),
        thumbnail_urls: z.object({ sm: z.string(), md: z.string(), lg: z.string() }).nullable(),
        blurhash: text,
        size_bytes: z.number(),
        duration_seconds: z.number().nullable(),
        relevance: z.number().nullable(),
        tags: z.array(z.string()),
        taught_tags: z.array(z.string()),
    });
    const folderHit = z.object({
        result_type: z.literal('collection'),
        id,
        name: z.string(),
        path: z.string(),
        description: text,
        emoji: text,
        document_count: z.number(),
        snippet: text,
        relevance: z.number().nullable(),
    });
    const facet = z.array(z.object({ name: z.string(), count: z.number(), selected: z.boolean().optional() }));
    const facets = z.object({
        types: facet,
        formats: facet,
        folders: facet,
        uploadPeriod: facet,
        tags: facet,
        hasText: facet,
        categories: facet,
        entities: facet.optional(),
        locations: facet.optional(),
    });

    return {
        tree: z.array(node),
        search: z.object({
            total: z.number(),
            results: z.array(z.discriminatedUnion('result_type', [documentHit, folderHit])),
            facets: facets.optional(),
            query: z.record(z.unknown()).optional(),
            timing_ms: z.number(),
        }),
    };
}

/**
 * Android 1.0.28's DTOs: a property without a default is required, one with a default may be missing, and only a
 * nullable one may be null.
 */
function toAndroidSchemas() {
    const text = z.string();
    const int = z.number().int();
    const maybe = z.string().nullish();
    const total = { count: int.optional(), bytes: int.optional() };
    const tile = z.object({ document_id: text, mime_type: text, original_filename: text, thumbnail_blurhash: maybe });
    const summary = z.object({
        image: z.object(total).optional(),
        video: z.object(total).optional(),
        file: z.object({ ...total, top_types: z.array(z.object({ ext: text, count: int })).optional() }).optional(),
    });
    const node: z.ZodTypeAny = z.object({
        id: text,
        parent_id: maybe,
        name: text,
        path: text,
        description: maybe,
        emoji: maybe,
        sort_order: int,
        is_private: z.boolean(),
        lock_id: maybe,
        locked: z.boolean().optional(),
        created_at: text,
        updated_at: text,
        children: z.lazy(() => z.array(node)).optional(),
        kind_counts: z.object({ image: int.optional(), video: int.optional(), file: int.optional() }).optional(),
        cover: z.object({ tiles: z.array(tile).optional(), summary: summary.optional() }).nullish(),
    });
    const documentHit = z.object({
        result_type: z.literal('document'),
        document_id: text,
        display_name: text,
        filename: text,
        folder_path: maybe,
        folder_id: maybe,
        uploaded_at: text,
        extracted_date: maybe,
        category: maybe,
        mime_type: text,
        format: text,
        snippet: maybe,
        has_text: z.boolean(),
        thumbnail_urls: z.object({ sm: text, md: text, lg: text }).nullish(),
        blurhash: maybe,
        size_bytes: int,
        duration_seconds: z.number().nullish(),
        relevance: z.number().nullish(),
        tags: z.array(text).optional(),
    });
    const folderHit = z.object({
        result_type: z.literal('collection'),
        id: text,
        name: text,
        path: text,
        description: maybe,
        emoji: maybe,
        snippet: maybe,
        relevance: z.number().nullish(),
    });
    const facet = z.array(z.object({ name: text, count: int, selected: z.boolean().nullish() }));
    const facets = z.object({
        types: facet.optional(),
        formats: facet.optional(),
        folders: facet.optional(),
        uploadPeriod: facet.optional(),
        tags: facet.optional(),
        hasText: facet.optional(),
        categories: facet.optional(),
        entities: facet.nullish(),
        locations: facet.nullish(),
    });

    return {
        tree: z.array(node),
        search: z.object({
            total: int,
            results: z.array(z.discriminatedUnion('result_type', [documentHit, folderHit])).optional(),
            facets: facets.nullish(),
            query: z.record(z.unknown()).nullish(),
            timing_ms: z.number(),
        }),
    };
}

interface NamedNode {
    name: string;
    children?: NamedNode[];
}

describe.each([
    ['the web app', toWebSchemas()],
    ['Android 1.0.28', toAndroidSchemas()],
])('%s reads', (_app, schemas) => {
    it('the folder tree, three levels deep', () => {
        const tree = schemas.tree.parse(fixture('folder-tree.json')) as NamedNode[];
        const third = tree.flatMap((top) => top.children ?? []).flatMap((second) => second.children ?? []);

        expect(third.map((node) => node.name)).toContain('Norway');
    });

    it.each([
        ['documents', 'folder-search.json', 'document'],
        ['a folder', 'folder-hit-search.json', 'collection'],
    ])('a search that finds %s', (_what, file, type) => {
        const found = schemas.search.parse(fixture(file));

        expect(found.results?.map((hit) => hit.result_type)).toContain(type);
    });
});
