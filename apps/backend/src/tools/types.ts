import type { z } from 'zod';

/** Error whose message is safe to show to the agent. Anything else a handler throws stays server-side. */
export class ToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolError';
    }
}

export type ToolAccess = 'read' | 'write';

/** The authenticated caller. Transports (MCP, in-app agent) build this from their own auth. */
export interface ToolContext {
    user: { id: string };
    /** Where the caller reaches this server (no trailing slash), for a tool that hands out a URL on it. */
    publicBaseUrl?: string;
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description: string;
    access: ToolAccess;
    /** Must be a plain z.object (no top-level refine/union) so it converts to JSON Schema. */
    inputSchema: S;
    handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

/** Type-checks a definition against its own schema while erasing the schema type for the registry list. */
export function defineTool<S extends z.ZodTypeAny>(tool: ToolDefinition<S>): ToolDefinition {
    return tool as unknown as ToolDefinition;
}
