/**
 * Organize Service
 *
 * Orchestrates AI-driven document organization via the OpenAI Responses API.
 * Runs a streaming tool-call loop and writes SSE events to the response stream.
 */

import type { OrganizeDocumentPreview, OrganizeOperation } from '@reverie/shared';
import type { ServerResponse } from 'http';
import { db } from '../db/kysely';
import { streamResponsesAPI, type FunctionTool, type ResponseInputItem } from '../llm/openai.client';
import { parseQuery } from '../search/query-parser';
import { search } from '../search/search.service';
import { getFolderService } from './folder.service';
import { getStorageService } from './storage.service';

const folderService = getFolderService();
const storageService = getStorageService();

// ── SSE helpers ──────────────────────────────────────────────────────────────

function writeSse(res: ServerResponse, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
}

// ── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: FunctionTool[] = [
    {
        type: 'function',
        name: 'search_documents',
        description:
            'Search for documents matching the given criteria. Use this to find documents before proposing organization actions. Always call this before propose_organization.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: [
                        'Search query using filter syntax and/or plain text. Combine as needed.',
                        '',
                        'IMPORTANT - how photos are indexed:',
                        '  Photos are NOT processed by the LLM. Their location (city, country) and date come from',
                        '  EXIF metadata and are stored as plain text in the search index.',
                        '  To find photos by location, use plain text (e.g. "spain", "barcelona").',
                        '  To filter by the date the photo was taken, use date:<year>.',
                        '',
                        'Supported filters (combine with plain text):',
                        '  category:<value> - Document category. For photos use category:photo. Other values: receipt, screenshot, document, etc.',
                        '  format:<value>   - File format. Values: pdf, jpg, png, heic, etc.',
                        '  tag:<value>      - Tag applied to a document.',
                        '  date:<value>     - Extracted/taken date. Examples: date:2025, date:2024-06, date:2022-2025',
                        '  uploaded:<value> - Upload date. Examples: uploaded:2024, uploaded:last-week',
                        '  folder:<name>    - Filter by folder name.',
                        '  has:text         - Only documents with extracted text.',
                        '',
                        'Examples:',
                        '  "category:photo spain date:2025"      ← photos from Spain taken in 2025',
                        '  "category:photo barcelona"             ← photos from Barcelona (any year)',
                        '  "category:photo date:2024"             ← all photos taken in 2024',
                        '  "category:receipt uploaded:2024"       ← receipts uploaded in 2024',
                        '  "invoice 2024"                         ← plain text full-text search',
                    ].join('\n'),
                },
                limit: {
                    type: ['number', 'null'],
                    description: 'Max results to return. Default 50, max 200. Pass null to use the default.',
                },
            },
            required: ['query', 'limit'],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        type: 'function',
        name: 'list_folders',
        description:
            'List the current folder structure so you can see what categories and sections already exist. Call this when the user wants help organizing, or when you need to know existing folders to avoid creating duplicates.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        type: 'function',
        name: 'propose_organization',
        description:
            'Propose a set of document organization operations for the user to review. Call this once you have found the relevant documents via search_documents and determined appropriate folder destinations. Each operation moves a group of documents to a single target folder.',
        parameters: {
            type: 'object',
            properties: {
                summary: {
                    type: 'string',
                    description:
                        'A brief, friendly summary of the proposed changes. E.g. "I found 23 photos from Spain taken in 2025. I\'ll move them to a new section called Spain 2025 Trip."',
                },
                operations: {
                    type: 'array',
                    description: 'List of move operations, each targeting one folder.',
                    items: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['move', 'create_and_move'],
                                description: 'Use "move" for existing folders, "create_and_move" when creating a new folder.',
                            },
                            document_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of document UUIDs to move.',
                            },
                            target_folder_name: {
                                type: 'string',
                                description: 'Name of the target folder (new or existing section name).',
                            },
                            target_folder_id: {
                                type: ['string', 'null'],
                                description: 'UUID of the existing folder. Required when type is "move", null otherwise.',
                            },
                            target_folder_parent_id: {
                                type: ['string', 'null'],
                                description:
                                    'UUID of an existing parent category when creating a new section. Use when the parent category already exists. Null if creating a new parent category or moving to an existing folder.',
                            },
                            target_folder_new_parent_name: {
                                type: ['string', 'null'],
                                description:
                                    'Name for a NEW top-level category to create as the parent. Use when no suitable existing category exists. Set this instead of target_folder_parent_id when you want to create both a new category and a new section inside it.',
                            },
                            is_new: {
                                type: 'boolean',
                                description: 'Whether this is a new folder that does not exist yet.',
                            },
                        },
                        required: [
                            'type',
                            'document_ids',
                            'target_folder_name',
                            'is_new',
                            'target_folder_id',
                            'target_folder_parent_id',
                            'target_folder_new_parent_name',
                        ],
                        additionalProperties: false,
                    },
                },
            },
            required: ['summary', 'operations'],
            additionalProperties: false,
        },
        strict: true,
    },
];

// ── Tool Execution ────────────────────────────────────────────────────────────

interface SearchDocumentsArgs {
    query: string;
    limit?: number;
}

interface ListFoldersArgs {}

interface ProposeOperationRaw {
    type: 'move' | 'create_and_move';
    document_ids: string[];
    target_folder_name: string;
    target_folder_id?: string | null;
    target_folder_parent_id?: string | null;
    target_folder_new_parent_name?: string | null;
    is_new: boolean;
}

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
        return JSON.stringify({ found: 0, documents: [] });
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

    return JSON.stringify({ found: result.total, showing: documents.length, documents });
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
            const thumbnailUrl = doc.thumbnail_paths ? await storageService.getFileUrl(doc.thumbnail_paths.sm) : null;

            return {
                id: doc.id,
                display_name: doc.original_filename,
                thumbnail_url: thumbnailUrl,
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

How documents are indexed (important for forming good queries):
- Photos: location (city, country) and taken date come from EXIF metadata and are plain-text searchable. Use "type:photo spain date:2025" to find Spain photos from 2025 - plain text for location, date: filter for year.
- Other documents: may have AI-generated tags, categories, and summaries. Use category:, tag:, and plain text for content search.

Guidelines:
- When the user gives a clear intent, call search_documents first, then propose_organization.
  Good photo query example: "category:photo spain date:2025"
  Good document query example: "category:receipt uploaded:2024"
- When the user asks for help or is vague, call list_folders and search_documents for unorganized documents, then describe what you found and ask what they'd like to do.
- Keep text responses concise and friendly. Don't explain your tool usage, just focus on helping.
- If the user's message makes no sense or is off-topic, politely explain what you can help with and give 2-3 examples.
- Only call propose_organization when you have found the actual document IDs via search_documents.
- Documents are moved into "section" type folders. Sections live inside "category" folders (two-level hierarchy).
- If a suitable section doesn't exist, use create_and_move with target_folder_parent_id set to an existing category's UUID.
- If no suitable category exists either, use create_and_move with target_folder_new_parent_name set to a new category name AND target_folder_parent_id null. This creates both a new top-level category and the section inside it.
- Prefer creating new categories when the user's content clearly belongs to a new top-level grouping (e.g. "Trips", "Work", "Family"). Don't force documents into irrelevant existing categories.`;

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
                const operations: OrganizeOperation[] = await Promise.all(
                    args.operations.map(async (op) => {
                        const previews = await buildDocumentPreviews(op.document_ids, userId);

                        return {
                            type: op.type,
                            document_ids: op.document_ids,
                            document_previews: previews,
                            target_folder: {
                                id: op.target_folder_id ?? undefined,
                                name: op.target_folder_name,
                                parent_id: op.target_folder_parent_id ?? undefined,
                                new_parent_name: op.target_folder_new_parent_name ?? undefined,
                                is_new: op.is_new,
                            },
                        };
                    }),
                );

                writeSse(res, 'proposal', {
                    summary: args.summary,
                    operations,
                });

                stopAfterNextTextResponse = true;
                result = 'Proposal emitted to the user for review. Briefly confirm what you proposed in one sentence.';
            } else if (tc.name === 'search_documents') {
                const args = JSON.parse(tc.argumentsJson) as SearchDocumentsArgs;
                writeSse(res, 'status', {
                    action: `Searching for "${args.query}"...`,
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
}

export async function executeOrganize(options: ExecuteOrganizeOptions): Promise<ExecuteOrganizeResult> {
    const { operations, userId } = options;
    let movedCount = 0;
    let foldersCreated = 0;

    for (const op of operations) {
        let folderId = op.target_folder.id;

        // Create new folder if needed
        if (op.target_folder.is_new || !folderId) {
            let parentId = op.target_folder.parent_id;

            // If a new parent category is requested, create it first
            if (op.target_folder.new_parent_name) {
                const newCategory = await folderService.createFolder(userId, op.target_folder.new_parent_name, undefined, undefined, null, 'category');
                parentId = newCategory.id;
                foldersCreated++;
            }

            const newFolder = await folderService.createFolder(userId, op.target_folder.name, parentId, undefined, null, 'section');
            folderId = newFolder.id;
            foldersCreated++;
        }

        if (!folderId || op.document_ids.length === 0) continue;

        // Move documents to the target folder
        const result = await db
            .updateTable('documents')
            .set({ folder_id: folderId, updated_at: new Date() })
            .where('id', 'in', op.document_ids)
            .where('user_id', '=', userId)
            .executeTakeFirst();

        movedCount += Number(result.numUpdatedRows ?? 0);
    }

    return { moved_count: movedCount, folders_created: foldersCreated };
}
