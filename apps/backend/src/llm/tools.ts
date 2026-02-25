import { FunctionTool } from './openai.client';

export const TOOLS: FunctionTool[] = [
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
            'Propose a set of document organization operations for the user to review. Call this once you have found the relevant documents via search_documents and determined appropriate folder destinations. Operations can move documents to folders or delete empty folders (e.g. after moving all docs out).',
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
                            target_folder_name: {
                                type: 'string',
                                description: 'Name of the target folder (new or existing section name). Required for move/create_and_move.',
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
                                    'Name for a NEW top-level category to create as the parent. Set this instead of target_folder_parent_id when you want to create both a new category and a new section inside it.',
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
