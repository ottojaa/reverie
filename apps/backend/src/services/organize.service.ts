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
import { parseQuery } from '../search/query-parser';
import { search } from '../search/search.service';
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

interface SearchDocumentsArgs {
    query: string;
    limit?: number;
}

interface ListFoldersArgs {}

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

async function execSearchDocuments(args: SearchDocumentsArgs, userId: string): Promise<string> {
    const limit = Math.min(args.limit ?? 50, 200);

    // Debug: log the raw args and parsed query so issues are visible in server logs
    const parsedDebug = parseQuery(args.query);
    console.log('[organize:search] query=%o parsed=%o', args.query, parsedDebug);

    const result = await search(
        {
            q: args.query,
            sort_by: 'relevance',
            sort_order: 'desc',
            include_facets: false,
            limit,
            offset: 0,
        },
        { userId },
    );

    console.log('[organize:search] total=%d returning=%d', result.total, result.results.length);

    if (result.results.length === 0) {
        return JSON.stringify({ found: 0, document_ids: [], sample: [] });
    }

    const documents = result.results.map((r) => ({
        id: r.document_id,
        display_name: r.display_name,
        folder_path: r.folder_path,
        folder_id: r.folder_id,
        category: r.category,
        format: r.format,
        mime_type: r.mime_type,
        extracted_date: r.extracted_date,
        uploaded_at: r.uploaded_at,
        tags: r.tags,
    }));

    // Return slim payload to LLM: all IDs for propose_organization, but only a small sample
    // with full metadata to avoid context bloat (200 docs × ~250 chars = ~15k tokens)
    const SAMPLE_SIZE = 15;
    const sample = documents.slice(0, SAMPLE_SIZE);
    const document_ids = documents.map((d) => d.id);

    return JSON.stringify({
        found: result.total,
        showing: documents.length,
        document_ids,
        sample,
    });
}

async function execListFolders(_args: ListFoldersArgs, userId: string): Promise<string> {
    const tree = await folderService.getSectionTree(userId);

    const simplified = tree.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        document_count: category.document_count,
        sections: category.children.map((section) => ({
            id: section.id,
            name: section.name,
            type: section.type,
            document_count: section.document_count,
        })),
    }));

    return JSON.stringify({ folders: simplified });
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

const SYSTEM_PROMPT = `You are Reverie's document organization assistant. Your job is to help users organize their uploaded files into folders.

Available tools:
- search_documents: Find documents matching criteria (locations, dates, categories, file types, tags, etc.)
- list_folders: See the current folder structure
- propose_organization: Present a structured organization plan to the user

CRITICAL - You MUST call propose_organization to present any organization plan. Never describe a plan in text alone—the user cannot confirm or execute without the proposal panel appearing on the right. If you have document IDs and a plan, call propose_organization immediately.

How documents are indexed (important for forming good queries):
- Photos: location (city, country) and taken date come from EXIF metadata and are plain-text searchable. Use "type:photo spain date:2025" to find Spain photos from 2025 - plain text for location, date: filter for year.
- Other documents: may have AI-generated tags, categories, and summaries. Use category:, tag:, and plain text for content search.

Guidelines:
- When the user gives a clear intent, call search_documents first, then propose_organization.
  Good photo query example: "category:photo spain date:2025"
  Good document query example: "category:receipt uploaded:2024"
- When the user asks for help or is vague, call list_folders and search_documents for unorganized documents, then describe what you found and ask what they'd like to do.
- When presenting multiple options, always number them (1, 2, 3, etc.). Accept short replies like "1", "2", "option 3" as selecting that option—interpret and proceed accordingly.
- Keep text responses concise and friendly. Don't explain your tool usage, just focus on helping.
- If the user's message makes no sense or is off-topic, politely explain what you can help with and give 2-3 examples.
- Only call propose_organization when you have found the actual document IDs via search_documents.
- Documents are moved into "section" type folders. Sections live inside "category" folders (two-level hierarchy).
- If a suitable section doesn't exist, use create_and_move with target_folder_parent_id set to an existing category's UUID.
- If no suitable category exists either, use create_and_move with target_folder_new_parent_name set to a new category name AND target_folder_parent_id null. This creates both a new top-level category and the section inside it.
- Prefer creating new categories when the user's content clearly belongs to a new top-level grouping (e.g. "Trips", "Work", "Family"). Don't force documents into irrelevant existing categories.
- When moving all documents out of a folder, you can include a delete_folder operation to remove the now-empty folder. Use the folder's UUID and name from list_folders.

After proposing: Tell the user to review the changes in the right panel and use the Confirm or Discard button there. Do NOT ask "ready to apply?" or similar—that is confusing. The user must use the panel's Confirm/Discard buttons. Never claim you have applied changes—only the user can do that by clicking Confirm.`;

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
            } else if (tc.name === 'search_documents') {
                const args = JSON.parse(tc.argumentsJson) as SearchDocumentsArgs;
                writeSse(res, 'status', {
                    action: 'Searching documents that match the criteria...',
                });
                result = await execSearchDocuments(args, userId);
            } else if (tc.name === 'list_folders') {
                writeSse(res, 'status', { action: 'Analyzing your folder structure...' });
                result = await execListFolders({}, userId);
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
