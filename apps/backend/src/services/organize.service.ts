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
import { findDocumentsForOrganize, getCategoryOverview, getFolderOverview } from '../search/search.service';
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
    group_by?: 'category' | 'category_year' | null;
}

interface ProposeMoveOperationRaw {
    type: 'move' | 'create_and_move';
    document_ids: string[];
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

// ── Main streaming loop ───────────────────────────────────────────────────────

export interface OrganizeChatOptions {
    message: string;
    responseId: string | undefined;
    userId: string;
    res: ServerResponse;
}

const SYSTEM_PROMPT = `You are Reverie's document organization assistant. You propose ONE concrete plan per request. You do not list options. You do not ask clarifying questions unless the answer materially changes the result.

Tools:
- get_category_overview: Returns document categories this user has (id, label, count). Call when user intent is vague (e.g. "financial documents", "medical docs") to pick which categories match. Then use category:X in find_documents.
- get_folder_overview: Returns aggregated folder stats (path, document_count, category_distribution, date_range). Call when you need destination context.
- find_documents: Returns document IDs and summary. Use group_by: "category" or "category_year" for "organize better" requests to get groups per type or type+year.
- propose_organization: Present your plan. Call after find_documents when you have IDs and a target.

Rules:
1. When user intent is vague (e.g. "financial documents", "medical docs", "receipts"): Call get_category_overview first. Use the labels to decide which categories match, then call find_documents with category:X filters.
2. On clear intent (e.g. "move bank docs to Finance"): Call find_documents with category/query, then propose_organization. One round.
3. Never enumerate folders. Use get_folder_overview for structural context. If no suitable folder exists, use create_and_move with a new folder name.
4. Never ask "which folder?"—pick the best match. If unsure, state your assumption: "I'm putting these in Finance—change the target in the panel if needed."
5. One plan per message. No "Option 1, Option 2, Option 3."
6. Keep responses under 2 sentences unless the user asks for explanation.
7. After proposing: "Review the panel and Confirm or Discard." Do not ask "ready to apply?"
8. Hierarchy: exactly 2 levels—collection (root) contains folder. Paths are /CollectionName/FolderName only. No nesting folders under folders.
9. find_documents returns: { total, document_ids, summary, groups? }. When group_by is used, groups has { category, year?, document_ids, count, date_range }. Use document_ids from each group for separate operations.

Path structure (critical—must follow or execution fails):
- target_folder_new_parent_name = collection name (e.g. "Bank Statements", "Stock Statements", "Invoices", "Photos"). Use document type as collection.
- target_folder_name = folder name only (e.g. "2024", "1998", "Misc"). Do NOT use slashes like "Bank Statements/1998"—that creates invalid 3-level paths.
- For "organize better": create separate top-level collections per type (Bank Statements, Stock Statements, Invoices). Each collection has folders named by year (2024, 2023, etc.) or "Misc" for undated.

Date matching (critical):
- Only use an existing folder if its date_range matches the documents. get_folder_overview includes date_range per folder.
- Folder names like "1998-2000" imply a date range. If documents span 1998-2026, do NOT put them in a folder named "1998-2000". Create new folders or use a folder whose date_range covers the documents.
- When reusing a folder, check that folder.date_range.min/max overlap with the documents' summary.date_range.

"Organize better" / "improve organization" / "organize in a better way":
- Do NOT dump everything into one existing folder. Propose a new structure.
- Call find_documents with group_by: "category_year" to get groups per document type and year.
- Create separate top-level collections per document type: Bank Statements, Stock Statements, Invoices (not one "Financial Documents" with subfolders). Each collection has folders named by year (2024, 2023, etc.) or "Misc" for undated.
- Each operation: target_folder_new_parent_name = collection (e.g. "Bank Statements"), target_folder_name = year or "Misc" (e.g. "2024", "1998", "Misc"). Never use slashes in target_folder_name.
- For photos: collection by location or "Photos", folders by year. Use find_documents with category:photo and date:YYYY or location text.
- Use get_category_overview labels for collection names (e.g. bank_statement -> "Bank Statements").

Evaluate existing folders:
- Use get_folder_overview. If a folder's date_range and category_distribution match the documents well, use it. Otherwise create a new structure.
- Prefer creating new collections/folders when the proposed structure is clearly better than existing ones.

How documents are indexed:
- Photos: location (city, country) and taken date from EXIF. Use "category:photo spain date:2025" for Spain photos from 2025.
- Other documents: category:, tag:, plain text. Examples: "category:receipt uploaded:2024", "category:photo barcelona"`;


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

        // Execute all tool calls from this turn
        const toolOutputs: ResponseInputItem[] = [];

        for (const tc of pendingToolCalls) {
            let result: string;

            if (tc.name === 'propose_organization') {
                // Parse and emit the proposal as a structured SSE event
                const args = JSON.parse(tc.argumentsJson) as ProposeOrganizationArgs;
                const rawOps = await Promise.all(
                    args.operations.map(async (op) => {
                        if (op.type === 'delete_folder') {
                            return {
                                type: 'delete_folder' as const,
                                folder_id: op.folder_id,
                                folder_name: op.folder_name,
                            };
                        }

                        // Move or create_and_move
                        const documentIds = await resolveDocumentIds(op.document_ids ?? [], userId);

                        if (documentIds.length === 0) return null;

                        const previews = await buildDocumentPreviews(documentIds, userId);

                        return {
                            type: op.type,
                            document_ids: documentIds,
                            document_previews: previews,
                            target_folder: {
                                ...(op.target_folder_id != null && { id: op.target_folder_id }),
                                name: op.target_folder_name,
                                ...(op.target_folder_parent_id != null && { parent_id: op.target_folder_parent_id }),
                                ...(op.target_folder_new_parent_name != null && { new_parent_name: op.target_folder_new_parent_name }),
                                is_new: op.is_new,
                            },
                        };
                    }),
                );

                const operations = rawOps.filter((o) => o !== null) as OrganizeOperation[];

                writeSse(res, 'proposal', {
                    summary: args.summary,
                    operations,
                });

                stopAfterNextTextResponse = true;
                result = 'Proposal emitted to the user for review. Briefly confirm what you proposed in one sentence.';
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

            toolOutputs.push({
                type: 'function_call_output',
                call_id: tc.callId,
                output: result,
            } as ResponseInputItem);
        }

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
