/**
 * Organize Service
 *
 * Orchestrates AI-driven document organization via the Anthropic Messages API.
 * Runs a streaming tool-call loop and writes SSE events to the response stream.
 *
 * Conversation state (message history + group_id → document-id stash) is kept in
 * Redis, keyed by an opaque `response_id` the client round-trips — the Messages
 * API is stateless, so we resend history each turn (see organize-conversation.store).
 *
 * Performance: find_documents hands the model short group_ids instead of raw
 * document UUIDs; the server resolves group_id → ids from the stash. This keeps
 * the model's context (and every stateless resend) small. The system prompt and
 * tool definitions are cached (cache_control) so they're re-read cheaply.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { OrganizeDocumentPreview, OrganizeOperation } from '@reverie/shared';
import type { ServerResponse } from 'http';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { getAnthropicClient } from '../llm/anthropic.client';
import { TOOLS } from '../llm/tools';
import { findDocumentsForOrganize, getCategoryOverview, getFolderOverview, type FindDocumentsGroupBy } from '../search/search.service';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { getFolderService } from './folder.service';
import { createConversationId, loadConversation, newConversationState, saveConversation, type OrganizeConversationState } from './organize-conversation.store';
import { getStorageService } from './storage.service';

const folderService = getFolderService();
const storageService = getStorageService();

const ORGANIZE_MAX_TOKENS = 16000;

/** Human-readable status strings emitted when the model starts a read tool. */
const STATUS_BY_TOOL: Record<string, string> = {
    find_documents: 'Searching documents that match the criteria...',
    get_folder_overview: 'Analyzing your folder structure...',
    get_category_overview: 'Checking document categories...',
};

// ── SSE helpers ──────────────────────────────────────────────────────────────

function writeSse(res: ServerResponse, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
}

// ── Tool Execution ────────────────────────────────────────────────────────────

interface FindDocumentsArgs {
    query: string;
    limit?: number | null;
    group_by?: FindDocumentsGroupBy | null;
}

interface ProposeMoveOperationRaw {
    type: 'move' | 'create_and_move';
    group_id?: string | null;
    document_ids?: string[] | null;
    source_query?: string | null;
    target_folder_name: string;
    target_folder_id?: string | null;
    target_folder_parent_id?: string | null;
    target_folder_new_parent_name?: string | null;
    is_new: boolean;
}

interface ProposeDeleteFolderOperationRaw {
    type: 'delete_folder';
    folder_id: string;
    folder_name: string;
}

type ProposeOperationRaw = ProposeMoveOperationRaw | ProposeDeleteFolderOperationRaw;

interface ProposeOrganizationArgs {
    summary: string;
    operations: ProposeOperationRaw[];
}

/**
 * Execute find_documents: allocate a short group_id per group, stash the resolved
 * document ids in conversation state, and return a payload WITHOUT raw ids so the
 * model never has to read or echo thousands of UUIDs.
 */
async function execFindDocuments(args: FindDocumentsArgs, userId: string, state: OrganizeConversationState): Promise<string> {
    const result = await findDocumentsForOrganize(args.query, {
        userId,
        limit: args.limit ?? 200,
        group_by: args.group_by ?? undefined,
    });

    if (result.total === 0) {
        return JSON.stringify({
            total: 0,
            groups: [],
            message:
                'No documents found matching this query. Respond to the user briefly: you did not find any documents to organize. Do NOT suggest folder structures, do NOT say "Review the panel", do NOT offer to scan again.',
        });
    }

    if (result.groups) {
        const groups = result.groups.map((g) => {
            const groupId = `g${++state.groupCounter}`;

            state.groups[groupId] = g.document_ids;

            return {
                group_id: groupId,
                category: g.category,
                year: g.year,
                location: g.location,
                count: g.count,
                source_query: g.source_query,
                date_range: g.date_range,
                folder_distribution: g.folder_distribution,
            };
        });

        return JSON.stringify({ total: result.total, summary: result.summary, groups });
    }

    // Flat result: expose the whole match set as a single referenceable group.
    const groupId = `g${++state.groupCounter}`;

    state.groups[groupId] = result.document_ids;

    return JSON.stringify({
        total: result.total,
        summary: result.summary,
        groups: [{ group_id: groupId, count: result.total }],
    });
}

async function execGetFolderOverview(userId: string): Promise<string> {
    const { folders } = await getFolderOverview(userId);

    return JSON.stringify({ folders });
}

async function execGetCategoryOverview(userId: string): Promise<string> {
    const { categories } = await getCategoryOverview(userId);

    return JSON.stringify({ categories });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only well-formed UUIDs (dedup). Used for the rare explicit document_ids fallback. */
function toValidDocumentIds(rawIds: string[]): string[] {
    return [...new Set(rawIds.map((id) => id.trim()).filter((id) => UUID_REGEX.test(id)))];
}

/**
 * Resolve an operation's target documents. Prefer the stashed group_id (the model's
 * normal path); fall back to a re-run source_query, then to explicit document_ids.
 */
async function resolveOperationDocumentIds(op: ProposeMoveOperationRaw, userId: string, state: OrganizeConversationState): Promise<string[]> {
    if (op.group_id) {
        const stashed = state.groups[op.group_id];

        if (stashed) return stashed;
    }

    if (op.source_query) {
        return resolveSourceQueryDocumentIds(op.source_query, userId);
    }

    if (op.document_ids && op.document_ids.length > 0) {
        return toValidDocumentIds(op.document_ids);
    }

    return [];
}

async function buildDocumentPreviews(documentIds: string[], userId: string): Promise<OrganizeDocumentPreview[]> {
    if (documentIds.length === 0) return [];

    const docs = await db
        .selectFrom('documents')
        .select(['id', 'original_filename', 'mime_type', 'thumbnail_paths'])
        .where('id', 'in', documentIds)
        .where('user_id', '=', userId)
        .execute();

    return Promise.all(
        docs.map(async (doc) => {
            const thumbnailUrls = await resolveThumbnailUrls(storageService, doc.thumbnail_paths);

            return {
                id: doc.id,
                display_name: doc.original_filename,
                thumbnail_urls: thumbnailUrls,
                mime_type: doc.mime_type,
            };
        }),
    );
}

async function resolveSourceQueryDocumentIds(sourceQuery: string | null | undefined, userId: string): Promise<string[]> {
    if (!sourceQuery) return [];

    const result = await findDocumentsForOrganize(sourceQuery, {
        userId,
        limit: 5000,
    });

    return result.document_ids;
}

/**
 * Canonicalize a move operation's target folder against existing folders.
 * If the resolved path already exists, set the real folder id and mark is_new=false.
 */
async function canonicalizeTargetFolder(op: ProposeMoveOperationRaw, userId: string): Promise<ProposeMoveOperationRaw> {
    let path: string | null = null;

    if (op.target_folder_new_parent_name) {
        path = `/${op.target_folder_new_parent_name}/${op.target_folder_name}`;
    } else if (op.target_folder_id) {
        return op;
    }

    if (!path) return op;

    const existing = await folderService.getFolderByPath(path, userId);

    if (!existing) return op;

    return {
        ...op,
        target_folder_id: existing.id,
        target_folder_parent_id: existing.parent_id,
        target_folder_new_parent_name: null,
        is_new: false,
    };
}

/**
 * Resolve an existing folder id for the proposed target without creating folders.
 * Mirrors path rules in executeOrganize.resolveFolderId, but only returns ids for folders that already exist.
 */
async function resolveExistingTargetFolderId(canonOp: ProposeMoveOperationRaw, userId: string): Promise<string | null> {
    if (canonOp.target_folder_id) return canonOp.target_folder_id;

    if (canonOp.target_folder_new_parent_name) {
        const path = `/${canonOp.target_folder_new_parent_name}/${canonOp.target_folder_name}`;
        const existing = await folderService.getFolderByPath(path, userId);

        return existing?.id ?? null;
    }

    if (canonOp.target_folder_parent_id) {
        const parent = await folderService.getFolder(canonOp.target_folder_parent_id, userId);

        if (!parent) return null;

        const path = `${parent.path}/${canonOp.target_folder_name}`.replace(/\/+/g, '/');
        const existing = await folderService.getFolderByPath(path, userId);

        return existing?.id ?? null;
    }

    return null;
}

async function loadDocumentFolderIds(documentIds: string[], userId: string): Promise<Map<string, string | null>> {
    if (documentIds.length === 0) return new Map();

    const rows = await db.selectFrom('documents').select(['id', 'folder_id']).where('id', 'in', documentIds).where('user_id', '=', userId).execute();

    const m = new Map<string, string | null>();

    for (const r of rows) {
        m.set(r.id, r.folder_id);
    }

    return m;
}

/** Exported for tests: keep only documents not already in targetFolderId. */
export function filterDocumentIdsNeedingMove(documentIds: string[], folderIdByDocumentId: Map<string, string | null>, targetFolderId: string): string[] {
    return documentIds.filter((id) => folderIdByDocumentId.get(id) !== targetFolderId);
}

/**
 * Execute propose_organization: resolve each operation to concrete documents/folders,
 * drop no-ops, build previews, and emit the SSE `proposal` event. Returns the tool
 * output string fed back to the model.
 */
async function execProposeOrganization(args: ProposeOrganizationArgs, userId: string, state: OrganizeConversationState, res: ServerResponse): Promise<string> {
    let moveAttempts = 0;
    let droppedNoMatchingDocs = 0;
    let droppedAllAlreadyInTarget = 0;

    const rawOps = await Promise.all(
        args.operations.map(async (op) => {
            if (op.type === 'delete_folder') {
                return {
                    type: 'delete_folder' as const,
                    folder_id: op.folder_id,
                    folder_name: op.folder_name,
                };
            }

            moveAttempts++;

            const canonOp = await canonicalizeTargetFolder(op, userId);
            let documentIds = await resolveOperationDocumentIds(canonOp, userId, state);

            if (documentIds.length === 0) {
                droppedNoMatchingDocs++;

                return null;
            }

            const targetFolderId = await resolveExistingTargetFolderId(canonOp, userId);

            if (targetFolderId) {
                const folderMap = await loadDocumentFolderIds(documentIds, userId);
                const beforeNoop = documentIds.length;

                documentIds = filterDocumentIdsNeedingMove(documentIds, folderMap, targetFolderId);

                if (documentIds.length === 0 && beforeNoop > 0) droppedAllAlreadyInTarget++;

                if (documentIds.length === 0) return null;
            }

            const previews = await buildDocumentPreviews(documentIds, userId);

            return {
                type: canonOp.type,
                document_ids: documentIds,
                document_previews: previews,
                target_folder: {
                    ...(canonOp.target_folder_id != null && { id: canonOp.target_folder_id }),
                    name: canonOp.target_folder_name,
                    ...(canonOp.target_folder_parent_id != null && { parent_id: canonOp.target_folder_parent_id }),
                    ...(canonOp.target_folder_new_parent_name != null && { new_parent_name: canonOp.target_folder_new_parent_name }),
                    is_new: canonOp.is_new,
                },
            };
        }),
    );

    const operations = rawOps.filter((o) => o !== null) as OrganizeOperation[];

    if (operations.length === 0) {
        const allMovesWereNoop = moveAttempts > 0 && droppedAllAlreadyInTarget === moveAttempts && droppedNoMatchingDocs === 0;

        return allMovesWereNoop
            ? JSON.stringify({
                  message:
                      'Every proposed move would leave documents where they already are. Tell the user briefly that their library already matches this layout. Do NOT suggest new folder structures, do NOT say "Review the panel", do NOT call propose_organization again for the same targets.',
              })
            : 'Proposal resolved to zero effective operations (no matching documents found). Retry with broader queries covering all relevant categories.';
    }

    writeSse(res, 'proposal', {
        summary: args.summary,
        operations,
    });

    return 'Proposal emitted to the user for review. Briefly confirm what you proposed in one sentence.';
}

/** Dispatch a single tool call and return its output string (with SSE side effects). */
async function executeToolCall(toolUse: Anthropic.ToolUseBlock, userId: string, state: OrganizeConversationState, res: ServerResponse): Promise<string> {
    switch (toolUse.name) {
        case 'find_documents':
            return execFindDocuments(toolUse.input as FindDocumentsArgs, userId, state);
        case 'get_folder_overview':
            return execGetFolderOverview(userId);
        case 'get_category_overview':
            return execGetCategoryOverview(userId);
        case 'propose_organization':
            return execProposeOrganization(toolUse.input as ProposeOrganizationArgs, userId, state, res);
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolUse.name}` });
    }
}

// ── Main streaming loop ───────────────────────────────────────────────────────

export interface OrganizeChatOptions {
    message: string;
    responseId: string | undefined;
    userId: string;
    res: ServerResponse;
}

const SYSTEM_PROMPT = `You are Reverie's document organization assistant. Propose ONE concrete plan per request.

Tools:
- get_category_overview: Returns categories with labels/counts. Use when intent is vague.
- get_folder_overview: Returns folder stats (path, document_count, category_distribution, date_range).
- find_documents: Returns groups, each with a group_id, folder_distribution (where docs live now), location, year, count. group_by supports "category", "category_year", "category_location_year".
- propose_organization: Emit final plan. Create one operation per find_documents group that still needs changes.

Rules:
1. One plan per message. No multiple options.
2. Hierarchy: exactly 2 levels — CollectionName / FolderName.
3. Never use slashes in target_folder_name.
4. Never ask "which folder?". Pick the best target.

Writing style:
- Write for non-technical users. Be friendly and clear.
- Never mention file paths or slash notation (no "/Photos/Spain - 2025"). Say "Spain - 2025 in Photos" instead.
- Use markdown: **bold** for folder/collection names, bullet lists when summarizing multiple groups.
- When find_documents returns 0 results, tell the user briefly and stop. Do not invent folder structures. Do not say "Review the panel and Confirm or Discard" unless you actually called propose_organization. Only say "Review the panel" after a proposal has been emitted.
- After propose_organization: keep it concise (1-3 sentences plus an optional bullet list). End with "Review the panel and **Confirm** or **Discard**."

Referencing groups:
- find_documents returns groups, each with a short group_id (e.g. "g1"). In propose_organization, set each operation's group_id to the matching group's group_id. The server resolves the documents from it — do NOT list document ids.
- Each group includes folder_distribution: if documents are already mostly under the folder path you would target, skip that group or say it is already organized.

Operation rules:
- Use create_and_move when creating a new destination folder.
- Use move when target_folder_id is known.
- target_folder_new_parent_name = collection name (top-level).
- target_folder_name = leaf folder name only.
- The server canonicalizes folders: if the path already exists, it reuses the existing folder automatically.

Photo folder naming (strict):
- ALWAYS use "<Country> - <Year>" when country exists (e.g. "Spain - 2025").
- NEVER use plain year for photos when country is available in the group.
- If country missing but year exists: "Misc - <Year>".
- If both missing: "Misc".
- Collection name: "Photos".

Financial doc naming:
- bank_statement, stock_statement, invoice, receipt: year folders (e.g. "2024"), "Misc" if undated.

Other categories:
- Use concise descriptive names from category label.

When user asks to improve/restructure organization:
- Call find_documents ONCE with query "" (empty string = match all) and group_by: "category_location_year". This returns all categories: photos grouped by country+year, other docs grouped by category+year.
- Build separate collections per category type (e.g. **Bank Statements**, **Photos**, **Invoices**).
- Create one propose_organization operation per group that still needs moves (omit groups that folder_distribution shows are already in the right place).
- If the user repeats the same broad request and folder hints show everything is already in place, say briefly that nothing needs changing and stop.

Search query syntax examples: "category:photo location:spain date:2025", "category:receipt uploaded:2024".`;

/** System prompt as a cacheable content block (stable across turns and requests). */
const SYSTEM_BLOCKS: Anthropic.TextBlockParam[] = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

/** Tool list with a cache breakpoint on the last tool (caches tools + system prefix). */
const CACHED_TOOLS: Anthropic.Tool[] = TOOLS.map((tool, i) => (i === TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool));

export async function runOrganizeChat(options: OrganizeChatOptions): Promise<void> {
    const { message, responseId, userId, res } = options;
    const client = getAnthropicClient();

    // Load prior conversation (Redis-backed) or start a new one.
    let conversationId = responseId;
    let state: OrganizeConversationState | null = responseId ? await loadConversation(responseId) : null;

    if (!state || !conversationId) {
        conversationId = createConversationId();
        state = newConversationState();
    }

    state.messages.push({ role: 'user', content: message });

    // Tool-call loop: each iteration is one streamed Messages API call.
    for (let iteration = 0; iteration < 10; iteration++) {
        const stream = client.messages.stream({
            model: env.ANTHROPIC_ORGANIZE_MODEL,
            max_tokens: ORGANIZE_MAX_TOKENS,
            system: SYSTEM_BLOCKS,
            thinking: { type: 'adaptive' },
            output_config: { effort: env.ANTHROPIC_EFFORT },
            tools: CACHED_TOOLS,
            messages: state.messages,
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                writeSse(res, 'delta', { content: event.delta.text });
            } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                const status = STATUS_BY_TOOL[event.content_block.name];

                if (status) writeSse(res, 'status', { action: status });
            }
        }

        const finalMessage = await stream.finalMessage();

        // Preserve the full assistant turn (incl. thinking + tool_use blocks) in history.
        state.messages.push({ role: 'assistant', content: finalMessage.content });

        if (finalMessage.stop_reason !== 'tool_use') {
            // Model produced its final text response — we're done.
            await saveConversation(conversationId, state);
            writeSse(res, 'done', { response_id: conversationId });

            return;
        }

        // Execute all tool calls from this turn in parallel, then feed results back.
        const toolUseBlocks = finalMessage.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');

        const toolResults = await Promise.all(
            toolUseBlocks.map(async (toolUse): Promise<Anthropic.ToolResultBlockParam> => {
                const output = await executeToolCall(toolUse, userId, state, res);

                return { type: 'tool_result', tool_use_id: toolUse.id, content: output };
            }),
        );

        state.messages.push({ role: 'user', content: toolResults });
    }

    // Iteration cap reached — persist and close the stream cleanly.
    await saveConversation(conversationId, state);
    writeSse(res, 'done', { response_id: conversationId });
}

// ── Execute Organization ──────────────────────────────────────────────────────

export interface ExecuteOrganizeOptions {
    operations: OrganizeOperation[];
    userId: string;
}

export interface ExecuteOrganizeResult {
    moved_count: number;
    folders_created: number;
    folders_deleted: number;
}

function isMoveOperation(op: OrganizeOperation): op is Extract<OrganizeOperation, { type: 'move' | 'create_and_move' }> {
    return op.type === 'move' || op.type === 'create_and_move';
}

export async function executeOrganize(options: ExecuteOrganizeOptions): Promise<ExecuteOrganizeResult> {
    const { operations, userId } = options;
    const moveOps = operations.filter(isMoveOperation);
    const deleteOps = operations.filter((op): op is Extract<OrganizeOperation, { type: 'delete_folder' }> => op.type === 'delete_folder');

    return db.transaction().execute(async (trx) => {
        let movedCount = 0;
        let foldersCreated = 0;
        let foldersDeleted = 0;

        const resolveFolderId = async (op: Extract<OrganizeOperation, { type: 'move' | 'create_and_move' }>): Promise<string | null> => {
            const folderId = op.target_folder.id;

            if (folderId) return folderId;

            if (!op.target_folder.is_new) return null;

            let path: string;

            if (op.target_folder.new_parent_name) {
                path = `/${op.target_folder.new_parent_name}/${op.target_folder.name}`;
            } else if (op.target_folder.parent_id) {
                const parent = await folderService.getFolder(op.target_folder.parent_id, userId, trx);

                if (!parent) return null;

                path = `${parent.path}/${op.target_folder.name}`;
            } else {
                return null;
            }

            const { folder, createdCount } = await folderService.getOrCreateFolderByPath(path, userId, trx);

            foldersCreated += createdCount;

            return folder.id;
        };

        // Process moves first so folders we intend to delete can become empty.
        // If a folder still has docs (e.g. user removed some moves from the proposal), deleteEmptyFolder throws and we skip.
        for (const op of moveOps) {
            const folderId = await resolveFolderId(op);

            if (!folderId || op.document_ids.length === 0) continue;

            const result = await trx
                .updateTable('documents')
                .set({ folder_id: folderId, updated_at: new Date() })
                .where('id', 'in', op.document_ids)
                .where('user_id', '=', userId)
                .executeTakeFirst();

            movedCount += Number(result.numUpdatedRows ?? 0);
        }

        // Process deletes (folders should now be empty after moves)
        for (const op of deleteOps) {
            try {
                await folderService.deleteEmptyFolder(op.folder_id, userId, trx);
                foldersDeleted++;
            } catch {
                // Skip if folder is not empty (e.g. user removed some docs from proposal)
            }
        }

        return { moved_count: movedCount, folders_created: foldersCreated, folders_deleted: foldersDeleted };
    });
}
