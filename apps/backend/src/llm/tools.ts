import { FunctionTool } from './openai.client';

export const TOOLS: FunctionTool[] = [
    {
        type: 'function',
        name: 'find_documents',
        description:
            'Find documents matching criteria. Returns document IDs, summary, and optional groups. Each group includes source_query (copy verbatim into propose_organization) and folder_distribution (top paths where those documents currently live—use to skip groups already in the right place). Use group_by for "organize better" requests.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'Search query. Filters: category:photo, category:bank_statement, date:2025, uploaded:2024, tag:X. Plain text for location. Examples: "category:photo spain date:2025", "category:bank_statement category:stock_statement".',
                },
                limit: {
                    type: ['number', 'null'],
                    description: 'Max results. Default 200. Pass null for default.',
                },
                group_by: {
                    type: ['string', 'null'],
                    enum: ['category', 'category_year', 'category_location_year', null],
                    description:
                        'Use "category" to group by document type (e.g. bank_statement, stock_statement). Use "category_year" to group by type and year. Use "category_location_year" for photos by location+year. Use for "organize better" requests to create structured folders. Null for flat results.',
                },
            },
            required: ['query', 'limit', 'group_by'],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        type: 'function',
        name: 'get_folder_overview',
        description:
            'Returns aggregated folder stats (path, document_count, category_distribution, date_range). Use for destination context. Call when you need to pick or create a target folder.',
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
        name: 'get_category_overview',
        description:
            'Returns document categories this user has, with counts and labels. Call when user intent is fuzzy (e.g. "financial documents", "medical docs") to pick which categories match. Then use category:X in find_documents.',
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
            'Propose organization operations for user review. For each group from find_documents, copy its source_query verbatim into the operation. Server resolves IDs from source_query. Create one operation per group.',
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
                    description: 'List of operations: move/create_and_move for document moves, delete_folder for removing empty folders.',
                    items: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['move', 'create_and_move', 'delete_folder'],
                                description:
                                    'Use "move" for existing folders, "create_and_move" when creating a new folder, "delete_folder" to remove an empty folder (e.g. after moving all docs out).',
                            },
                            document_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of document UUIDs to move. Required for move/create_and_move, omit for delete_folder.',
                            },
                            source_query: {
                                type: ['string', 'null'],
                                description:
                                    'Copy the source_query from the matching find_documents group VERBATIM. Server resolves document_ids from this. Always prefer this over document_ids.',
                            },
                            target_folder_name: {
                                type: 'string',
                                description:
                                    'Name of the target folder only (e.g. "2024", "Misc"). No slashes. With new_parent_name, path is /new_parent_name/target_folder_name.',
                            },
                            target_folder_id: {
                                type: ['string', 'null'],
                                description: 'UUID of the existing folder. Required when type is "move", null otherwise.',
                            },
                            target_folder_parent_id: {
                                type: ['string', 'null'],
                                description:
                                    'UUID of an existing parent category when creating a new section. Null if creating a new parent category or moving to an existing folder.',
                            },
                            target_folder_new_parent_name: {
                                type: ['string', 'null'],
                                description:
                                    'Name for a NEW top-level collection. Path is /new_parent_name/target_folder_name only (2 levels). E.g. new_parent_name="Bank Statements", target_folder_name="2024" creates /Bank Statements/2024. Do NOT use slashes in target_folder_name.',
                            },
                            is_new: {
                                type: 'boolean',
                                description: 'Whether this is a new folder that does not exist yet. Required for move/create_and_move.',
                            },
                            folder_id: {
                                type: 'string',
                                description: 'UUID of the folder to delete. Required when type is "delete_folder".',
                            },
                            folder_name: {
                                type: 'string',
                                description: 'Name of the folder to delete (for display). Required when type is "delete_folder".',
                            },
                        },
                        required: ['type'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['summary', 'operations'],
            additionalProperties: false,
        },
        strict: false, // oneOf not supported; we validate server-side for move vs delete_folder
    },
];
