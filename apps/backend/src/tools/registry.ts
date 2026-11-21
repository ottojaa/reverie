import { ZodError } from 'zod';
import { createFolder, renameFolder } from './folders-write';
import { addTags, removeTags } from './tags';
import { moveDocuments, renameDocument } from './documents-write';
import { findDuplicates } from './duplicates';
import { getDocument } from './get-document';
import { listFolderContents, listFolders } from './folders-read';
import { getLibraryOverview } from './overview';
import { searchDocuments } from './search';
import { ToolError, type ToolContext, type ToolDefinition } from './types';
import { undoWrite } from './undo';

/**
 * The library tools, in one place and independent of how they are exposed (MCP, in-app agent).
 * A transport lists the tools, hands the model each name, description and input schema, and calls
 * `callTool` with the authenticated user. There is deliberately no delete tool.
 */

export const TOOLS: readonly ToolDefinition[] = [
    searchDocuments,
    findDuplicates,
    getDocument,
    listFolders,
    listFolderContents,
    getLibraryOverview,
    addTags,
    removeTags,
    moveDocuments,
    createFolder,
    renameFolder,
    renameDocument,
    undoWrite,
];

export function listTools(): readonly ToolDefinition[] {
    return TOOLS;
}

function toInputMessage(error: ZodError): string {
    const issue = error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join('.') : 'input';

    return 'Invalid input: ' + where + ' ' + (issue?.message ?? 'is invalid');
}

export interface ToolCallResult {
    ok: boolean;
    /** The tool's output when ok, otherwise `{ error }` with a message that is safe to show. */
    output: unknown;
}

/** Run one tool. Refusals and bad input come back as a clear message; anything unexpected stays server-side. */
export async function callTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolCallResult> {
    const tool = TOOLS.find((candidate) => candidate.name === name);

    if (!tool) return { ok: false, output: { error: 'Unknown tool: ' + name } };

    const parsed = tool.inputSchema.safeParse(rawInput ?? {});

    if (!parsed.success) return { ok: false, output: { error: toInputMessage(parsed.error) } };

    try {
        return { ok: true, output: await tool.handler(parsed.data, ctx) };
    } catch (error) {
        if (error instanceof ToolError) return { ok: false, output: { error: error.message } };

        console.error('Tool failed', { tool: name, error });

        return { ok: false, output: { error: 'The tool failed: try again, or ask the owner to check the server log' } };
    }
}
