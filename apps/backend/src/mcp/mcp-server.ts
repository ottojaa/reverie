import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { callTool, listTools } from '../tools/registry.js';
import type { ToolContext, ToolDefinition } from '../tools/types.js';

/**
 * The MCP face of the tool registry. It lists the registry's tools and forwards each call to
 * `callTool` with the authenticated user; validation, refusals and the privacy rules all stay in
 * the registry. A server is built per request, for one user, so it holds no state between calls.
 */

const SERVER_INFO = { name: 'reverie', version: '1.0.0' };

function toMcpTool(tool: ToolDefinition): Tool {
    // No $refStrategy: every tool's schema is self-contained, which every MCP client copes with.
    const { $schema: _dialect, ...inputSchema } = zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }) as Record<string, unknown>;

    return {
        name: tool.name,
        description: tool.description,
        inputSchema: inputSchema as Tool['inputSchema'],
        annotations: { readOnlyHint: tool.access === 'read', destructiveHint: false, openWorldHint: false },
    };
}

let mcpTools: Tool[] | null = null;

export function listMcpTools(): Tool[] {
    mcpTools ??= listTools().map(toMcpTool);

    return mcpTools;
}

export function createMcpServer(ctx: ToolContext): Server {
    const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listMcpTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const result = await callTool(request.params.name, request.params.arguments, ctx);

        return { content: [{ type: 'text' as const, text: JSON.stringify(result.output) }], isError: !result.ok };
    });

    return server;
}
