/**
 * Organize Service
 *
 * Orchestrates AI-driven document organization via the OpenAI Responses API.
 * Runs a streaming tool-call loop and writes SSE events to the response stream.
 */

import type { OrganizeDocumentPreview, OrganizeOperation } from '@reverie/shared';
import type { ServerResponse } from 'http';
import { sql, type SqlBool } from 'kysely';
import { db } from '../db/kysely';
import { streamResponsesAPI, type ResponseInputItem } from '../llm/openai.client';
import { TOOLS } from '../llm/tools';
import {
    findDocumentsForOrganize,
    getCategoryOverview,
    getFolderOverview,
    type FindDocumentsGroupBy,
} from '../search/search.service';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { getFolderService } from './folder.service';
import { getStorageService } from './storage.service';

const folderService = getFolderService();
const storageService = getStorageService();

// ── SSE helpers ──────────────────────────────────────────────────────────────

function writeSse(res: ServerResponse, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
}

// ── Tool Execution ────────────────────────────────────────────────────────────

interface FindDocumentsArgs {
    query: string;
    limit?: number;
    group_by?: FindDocumentsGroupBy | null;
}

interface ProposeMoveOperationRaw {
    type: 'move' | 'create_and_move';
    document_ids?: string[];
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

async function execFindDocuments(args: FindDocumentsArgs, userId: string): Promise<string> {
    const result = await findDocumentsForOrganize(args.query, {
        userId,
        limit: args.limit ?? 200,
        group_by: args.group_by ?? undefined,
    });

    if (result.total === 0) {
        return JSON.stringify({
            total: 0,
            document_ids: [],
            message:
                'No documents found matching this query. Respond to the user briefly: you did not find any documents to organize. Do NOT suggest folder structures, do NOT say "Review the panel", do NOT offer to scan again.',
        });
    }

    const payload: Record<string, unknown> = {
        total: result.total,
        document_ids: result.document_ids,
        summary: result.summary,
    };

    if (result.groups) payload.groups = result.groups;

    return JSON.stringify(payload);
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

/**
 * LLMs sometimes truncate UUIDs (e.g. drop last char). Resolve invalid IDs by
 * prefix-matching against user's documents. Returns deduplicated valid UUIDs.
 */
async function resolveDocumentIds(rawIds: string[], userId: string): Promise<string[]> {
    const valid: string[] = [];
    const toResolve: string[] = [];

    for (const id of rawIds) {
        const trimmed = id.trim();

        if (UUID_REGEX.test(trimmed)) {
            valid.push(trimmed);
        } else if (trimmed.length >= 32 && /^[0-9a-f-]+$/i.test(trimmed)) {
            toResolve.push(trimmed);
        }
    }

    if (toResolve.length === 0) return [...new Set(valid)];

    const resolved: string[] = [];

    for (const prefix of toResolve) {
        const rows = await db
            .selectFrom('documents')
            .select('id')
            .where('user_id', '=', userId)
            .where(sql<SqlBool>`id::text like concat(${prefix}, '%')`)
            .execute();

        const first = rows[0];

        if (rows.length === 1 && first) resolved.push(first.id);
    }

    return [...new Set([...valid, ...resolved])];
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
async function canonicalizeTargetFolder(
    op: ProposeMoveOperationRaw,
    userId: string,
): Promise<ProposeMoveOperationRaw> {
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

    const rows = await db
        .selectFrom('documents')
        .select(['id', 'folder_id'])
        .where('id', 'in', documentIds)
        .where('user_id', '=', userId)
        .execute();

    const m = new Map<string, string | null>();

    for (const r of rows) {
        m.set(r.id, r.folder_id);
    }

    return m;
}

/** Exported for tests: keep only documents not already in targetFolderId. */
export function filterDocumentIdsNeedingMove(
    documentIds: string[],
    folderIdByDocumentId: Map<string, string | null>,
    targetFolderId: string,
): string[] {
    return documentIds.filter((id) => folderIdByDocumentId.get(id) !== targetFolderId);
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
- find_documents: Returns groups with source_query, document_ids, folder_distribution (where docs live now), location, year, count. group_by supports "category", "category_year", "category_location_year".
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

source_query:
- Groups from find_documents include a source_query field. When non-null, copy it VERBATIM into propose_organization. Do NOT invent your own query.
- When source_query is null, use the group's document_ids array instead.
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


export async function runOrganizeChat(options: OrganizeChatOptions): Promise<void> {
    const { message, responseId, userId, res } = options;

    // First-turn input includes the system prompt when starting a new conversation
    const firstTurnInput: ResponseInputItem[] = !responseId
        ? [{ role: 'system', content: SYSTEM_PROMPT } as ResponseInputItem, { role: 'user', content: message } as ResponseInputItem]
        : [{ role: 'user', content: message } as ResponseInputItem];

    let currentInput: string | ResponseInputItem[] = firstTurnInput;
    let currentResponseId = responseId;
    let stopAfterNextTextResponse = false;

    // Tool-call loop: each iteration is one Responses API call
    for (let iteration = 0; iteration < 10; iteration++) {
        const stream = await streamResponsesAPI({
            input: currentInput,
            tools: TOOLS,
            previousResponseId: currentResponseId,
        });

        // Accumulate tool call data for this turn
        let completedResponseId: string | undefined;
        const pendingToolCalls: Array<{ callId: string; name: string; argumentsJson: string }> = [];
        let currentToolCallIndex = -1;

        for await (const event of stream) {
            switch (event.type) {
                case 'response.created':
                    completedResponseId = event.response.id;
                    break;

                case 'response.output_text.delta':
                    writeSse(res, 'delta', { content: event.delta });
                    break;

                case 'response.output_item.added': {
                    const item = event.item;

                    if (item.type === 'function_call') {
                        currentToolCallIndex++;
                        pendingToolCalls[currentToolCallIndex] = {
                            callId: item.call_id,
                            name: item.name,
                            argumentsJson: '',
                        };
                    }

                    break;
                }

                case 'response.function_call_arguments.delta': {
                    const tc = currentToolCallIndex >= 0 ? pendingToolCalls[currentToolCallIndex] : undefined;

                    if (tc) tc.argumentsJson += event.delta;

                    break;
                }

                case 'response.output_item.done': {
                    const item = event.item;
                    const tc = currentToolCallIndex >= 0 ? pendingToolCalls[currentToolCallIndex] : undefined;

                    if (item.type === 'function_call' && tc) {
                        // Finalize the arguments for this tool call
                        tc.argumentsJson = item.arguments;
                    }

                    break;
                }

                case 'response.completed':
                    completedResponseId = event.response.id;
                    break;
            }
        }

        // If no tool calls, the model produced a text response - we're done
        if (pendingToolCalls.length === 0) {
            if (completedResponseId) {
                writeSse(res, 'done', { response_id: completedResponseId });
            }

            break;
        }

        // If the previous iteration emitted a proposal, the model just produced its
        // confirmation text in this iteration — stop now (pendingToolCalls was 0 above,
        // so this path handles the loop-termination after feeding back proposal output).
        if (stopAfterNextTextResponse) {
            if (completedResponseId) {
                writeSse(res, 'done', { response_id: completedResponseId });
            }

            break;
        }

        // Execute all tool calls from this turn in parallel
        const toolOutputs = await Promise.all(
            pendingToolCalls.map(async (tc) => {
                let result: string;

                if (tc.name === 'propose_organization') {
                    const args = JSON.parse(tc.argumentsJson) as ProposeOrganizationArgs;
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

                            const idsFromQuery = await resolveSourceQueryDocumentIds(canonOp.source_query, userId);
                            const rawIds = idsFromQuery.length > 0 ? idsFromQuery : (canonOp.document_ids ?? []);
                            let documentIds = await resolveDocumentIds(rawIds, userId);

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
                        const allMovesWereNoop =
                            moveAttempts > 0 &&
                            droppedAllAlreadyInTarget === moveAttempts &&
                            droppedNoMatchingDocs === 0;

                        result = allMovesWereNoop
                            ? JSON.stringify({
                                  message:
                                      'Every proposed move would leave documents where they already are. Tell the user briefly that their library already matches this layout. Do NOT suggest new folder structures, do NOT say "Review the panel", do NOT call propose_organization again for the same targets.',
                              })
                            : 'Proposal resolved to zero effective operations (no matching documents found). Retry with broader queries covering all relevant categories.';
                    } else {
                        writeSse(res, 'proposal', {
                            summary: args.summary,
                            operations,
                        });

                        stopAfterNextTextResponse = true;
                        result = 'Proposal emitted to the user for review. Briefly confirm what you proposed in one sentence.';
                    }
                } else if (tc.name === 'find_documents') {
                    const args = JSON.parse(tc.argumentsJson) as FindDocumentsArgs;
                    writeSse(res, 'status', {
                        action: 'Searching documents that match the criteria...',
                    });
                    result = await execFindDocuments(args, userId);
                } else if (tc.name === 'get_folder_overview') {
                    writeSse(res, 'status', { action: 'Analyzing your folder structure...' });
                    result = await execGetFolderOverview(userId);
                } else if (tc.name === 'get_category_overview') {
                    writeSse(res, 'status', { action: 'Checking document categories...' });
                    result = await execGetCategoryOverview(userId);
                } else {
                    result = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
                }

                return {
                    type: 'function_call_output',
                    call_id: tc.callId,
                    output: result,
                } as ResponseInputItem;
            }),
        );

        // Always feed tool outputs back to OpenAI so the conversation history is complete.
        // This is critical: skipping this leaves a dangling tool call in the history,
        // which causes "No tool output found" errors on subsequent messages.
        currentInput = toolOutputs;
        currentResponseId = completedResponseId;
    }
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
            let folderId = op.target_folder.id;

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
