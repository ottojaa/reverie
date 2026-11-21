import { sql } from 'kysely';
import { z } from 'zod';
import { sanitizeTag } from '../llm/tag-sanitizer';
import { deleteExclusions, planExclusions, type Exclusion } from '../taught-labels/exclusions';
import { addExclusions } from '../taught-labels/taught-labels.repository';
import type { Undoer } from './undo-types';
import { defineTool, ToolError } from './types';
import { assertVisibleDocuments } from './visibility';
import { dryRunShape, documentTargetShape, PREVIEW_SAMPLE_SIZE, rebuildSearchVectors, resolveDocumentIds, runWrite, type PlannedWrite } from './write';

/** add_tags / remove_tags, and the undo of each. Tags are stored lowercase (the q-DSL lowercases `tag:` values). */

const tagsShape = {
    tags: z.array(z.string().min(1).max(60)).min(1).max(10).describe('Tags: short keywords of at most four words'),
};

function toTags(raw: string[]): string[] {
    const cleaned = raw.map((tag) => ({ tag, clean: sanitizeTag(tag)?.toLowerCase() }));
    const invalid = cleaned.find((entry) => entry.clean === undefined);

    if (invalid) throw new ToolError('Invalid tag: ' + invalid.tag);

    return Array.from(new Set(cleaned.map((entry) => entry.clean!)));
}

/** document id -> tags */
type TagsByDocument = Record<string, string[]>;
type RemovedTag = { tag: string; source: 'user' | 'auto' | 'taught' };

export interface AddTagsState {
    added: TagsByDocument;
}

export interface RemoveTagsState {
    removed: Record<string, RemovedTag[]>;
    /** Taught-label exclusions the removal created (removing a taught label's tag keeps it from coming back); undo lifts them. */
    exclusions?: Exclusion[];
}

function countTags(byDocument: Record<string, unknown[]>): number {
    return Object.values(byDocument).reduce((total, tags) => total + tags.length, 0);
}

function toSample(byDocument: Record<string, unknown[]>, filenames: Map<string, string>) {
    return Object.entries(byDocument)
        .slice(0, PREVIEW_SAMPLE_SIZE)
        .map(([id, tags]) => ({ id, filename: filenames.get(id), tags: tags.map((tag) => (typeof tag === 'string' ? tag : (tag as RemovedTag).tag)) }));
}

async function loadExistingTags(trx: Parameters<PlannedWrite['apply']>[0], ids: string[], tags: string[]) {
    return trx
        .selectFrom('document_tags')
        .select(['document_id', 'tag', 'source'])
        .where('document_id', 'in', ids)
        .where(sql<boolean>`lower(tag) = ANY(${tags}::text[])`)
        .execute();
}

const addTagsSchema = z.object({ ...documentTargetShape, ...tagsShape, ...dryRunShape });

export const addTags = defineTool({
    name: 'add_tags',
    description: 'Add tags to documents, by ids or by a search selection. Undoable with undo_write.',
    access: 'write',
    inputSchema: addTagsSchema,
    handler: async (input, ctx) => {
        const ids = await resolveDocumentIds(ctx.user.id, input);
        const tags = toTags(input.tags);

        return runWrite({
            ctx,
            tool: 'add_tags',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                const docs = await assertVisibleDocuments(trx, vis, ids);
                const existing = await loadExistingTags(trx, ids, tags);
                const has = new Set(existing.map((row) => row.document_id + '\0' + row.tag.toLowerCase()));
                const added: TagsByDocument = {};

                for (const doc of docs) {
                    const missing = tags.filter((tag) => !has.has(doc.id + '\0' + tag));

                    if (missing.length > 0) added[doc.id] = missing;
                }

                const filenames = new Map(docs.map((doc) => [doc.id, doc.original_filename]));

                return {
                    preview: {
                        documents: docs.length,
                        documents_changed: Object.keys(added).length,
                        tags_added: countTags(added),
                        sample: toSample(added, filenames),
                    },
                    changes: countTags(added),
                    before: { added: {} },
                    after: { added } satisfies AddTagsState,
                    apply: async (t) => {
                        const rows = Object.entries(added).flatMap(([document_id, list]) => list.map((tag) => ({ document_id, tag, source: 'user' as const })));

                        await t
                            .insertInto('document_tags')
                            .values(rows)
                            .onConflict((oc) => oc.columns(['document_id', 'tag']).doNothing())
                            .execute();
                        await rebuildSearchVectors(t, Object.keys(added));
                    },
                };
            },
        });
    },
});

const removeTagsSchema = z.object({ ...documentTargetShape, ...tagsShape, ...dryRunShape });

export const removeTags = defineTool({
    name: 'remove_tags',
    description: 'Remove tags from documents, by ids or by a search selection. Undoable with undo_write.',
    access: 'write',
    inputSchema: removeTagsSchema,
    handler: async (input, ctx) => {
        const ids = await resolveDocumentIds(ctx.user.id, input);
        const tags = toTags(input.tags);

        return runWrite({
            ctx,
            tool: 'remove_tags',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                const docs = await assertVisibleDocuments(trx, vis, ids);
                const existing = await loadExistingTags(trx, ids, tags);
                const removed: Record<string, RemovedTag[]> = {};

                for (const row of existing) removed[row.document_id] = [...(removed[row.document_id] ?? []), { tag: row.tag, source: row.source }];

                const { exclusions, examples } = await planExclusions(
                    trx,
                    ctx.user.id,
                    existing.map((row) => ({ document_id: row.document_id, tag: row.tag })),
                );

                if (examples.length > 0) {
                    throw new ToolError(
                        'Cannot remove a taught label from one of its example images: ' +
                            examples[0]!.name +
                            '. Remove the example in the Taught labels manager instead',
                    );
                }

                const filenames = new Map(docs.map((doc) => [doc.id, doc.original_filename]));

                return {
                    preview: {
                        documents: docs.length,
                        documents_changed: Object.keys(removed).length,
                        tags_removed: countTags(removed),
                        sample: toSample(removed, filenames),
                    },
                    changes: countTags(removed),
                    before: { removed, exclusions } satisfies RemoveTagsState,
                    after: { removed: {} },
                    apply: async (t) => {
                        for (const [documentId, list] of Object.entries(removed)) {
                            await t
                                .deleteFrom('document_tags')
                                .where('document_id', '=', documentId)
                                .where(
                                    'tag',
                                    'in',
                                    list.map((entry) => entry.tag),
                                )
                                .execute();
                        }

                        await addExclusions(t, exclusions);
                        await rebuildSearchVectors(t, Object.keys(removed));
                    },
                };
            },
        });
    },
});

export const undoAddTags: Undoer = async (trx, vis, entry) => {
    const { added } = entry.after as AddTagsState;
    const ids = Object.keys(added);
    const docs = await assertVisibleDocuments(trx, vis, ids);
    const present = await trx.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', ids).execute();
    const has = new Set(present.map((row) => row.document_id + '\0' + row.tag));
    const gone = ids.flatMap((id) => added[id]!.filter((tag) => !has.has(id + '\0' + tag)));

    if (gone.length > 0) throw new ToolError('Cannot undo: ' + gone.length + ' of the added tags are no longer on their documents (e.g. ' + gone[0] + ')');

    const filenames = new Map(docs.map((doc) => [doc.id, doc.original_filename]));

    return {
        preview: { tags_removed: countTags(added), sample: toSample(added, filenames) },
        changes: countTags(added),
        before: entry.after,
        after: entry.before,
        apply: async (t) => {
            for (const [documentId, list] of Object.entries(added)) {
                await t.deleteFrom('document_tags').where('document_id', '=', documentId).where('tag', 'in', list).execute();
            }

            await rebuildSearchVectors(t, ids);
        },
    };
};

export const undoRemoveTags: Undoer = async (trx, vis, entry) => {
    const { removed, exclusions = [] } = entry.before as RemoveTagsState;
    const ids = Object.keys(removed);
    const docs = await assertVisibleDocuments(trx, vis, ids);
    const present = await trx.selectFrom('document_tags').select(['document_id', 'tag']).where('document_id', 'in', ids).execute();
    const has = new Set(present.map((row) => row.document_id + '\0' + row.tag));
    const back = ids.flatMap((id) => removed[id]!.filter((entryTag) => has.has(id + '\0' + entryTag.tag)));

    if (back.length > 0) throw new ToolError('Cannot undo: ' + back.length + ' of the removed tags were added again since (e.g. ' + back[0]!.tag + ')');

    const filenames = new Map(docs.map((doc) => [doc.id, doc.original_filename]));

    return {
        preview: { tags_restored: countTags(removed), sample: toSample(removed, filenames) },
        changes: countTags(removed),
        before: entry.after,
        after: entry.before,
        apply: async (t) => {
            const rows = Object.entries(removed).flatMap(([document_id, list]) => list.map(({ tag, source }) => ({ document_id, tag, source })));

            await t.insertInto('document_tags').values(rows).execute();
            await deleteExclusions(t, exclusions);
            await rebuildSearchVectors(t, ids);
        },
    };
};
