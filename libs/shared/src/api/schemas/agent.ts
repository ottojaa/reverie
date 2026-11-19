import { z } from 'zod';
import { DateStringSchema, UuidSchema } from './common.js';

// ── Chat content ─────────────────────────────────────────────────────────────

export const AgentTextItemSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});

export const AgentToolStatusSchema = z.enum(['running', 'done', 'error']);

export const AgentToolItemSchema = z.object({
    type: z.literal('tool'),
    /** The tool_use id claude assigned; pairs a call with its result. */
    id: z.string(),
    /** Registry tool name, without the `mcp__reverie__` prefix. */
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    status: AgentToolStatusSchema,
    /** Parsed JSON result when it was JSON, the raw text otherwise. Capped before it is stored. */
    output: z.unknown().optional(),
    /** Set on write tools: the audit row that Undo reverses. */
    audit_id: z.string().optional(),
    /** Write tools only: false for a dry run. */
    applied: z.boolean().optional(),
    /** Filled in when a chat is loaded, from the audit log. */
    undone: z.boolean().optional(),
});

export type AgentToolItem = z.infer<typeof AgentToolItemSchema>;

export const AgentItemSchema = z.discriminatedUnion('type', [AgentTextItemSchema, AgentToolItemSchema]);

export type AgentItem = z.infer<typeof AgentItemSchema>;

export const AgentRoleSchema = z.enum(['user', 'assistant']);

export const AgentMessageSchema = z.object({
    id: UuidSchema,
    role: AgentRoleSchema,
    items: z.array(AgentItemSchema),
    /** Set on an assistant message that ended in an error. */
    error: z.string().nullable(),
    created_at: DateStringSchema,
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentChatSchema = z.object({
    id: UuidSchema,
    title: z.string(),
    created_at: DateStringSchema,
    updated_at: DateStringSchema,
});

export type AgentChat = z.infer<typeof AgentChatSchema>;

// ── Live events (Socket.io `agent:event`) ────────────────────────────────────

export const AgentErrorCodeSchema = z.enum(['not_signed_in', 'unavailable', 'failed']);

export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

const eventBase = { chat_id: UuidSchema };

export const AgentEventSchema = z.discriminatedUnion('type', [
    z.object({ ...eventBase, type: z.literal('run_started') }),
    z.object({ ...eventBase, type: z.literal('text_delta'), text: z.string() }),
    z.object({ ...eventBase, type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
    z.object({
        ...eventBase,
        type: z.literal('tool_result'),
        id: z.string(),
        ok: z.boolean(),
        output: z.unknown().optional(),
        audit_id: z.string().optional(),
        applied: z.boolean().optional(),
    }),
    z.object({
        ...eventBase,
        type: z.literal('run_finished'),
        error: z.object({ code: AgentErrorCodeSchema, message: z.string() }).nullable(),
    }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ── Requests and responses ───────────────────────────────────────────────────

export const AgentStatusSchema = z.object({
    state: z.enum(['ready', 'not_signed_in', 'unavailable']),
});

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSendMessageRequestSchema = z.object({
    /** Omit to start a new chat. */
    chat_id: UuidSchema.optional(),
    prompt: z.string().trim().min(1).max(8000),
});

export type AgentSendMessageRequest = z.infer<typeof AgentSendMessageRequestSchema>;

export const AgentSendMessageResponseSchema = z.object({
    chat_id: UuidSchema,
});

export type AgentSendMessageResponse = z.infer<typeof AgentSendMessageResponseSchema>;

export const AgentChatParamsSchema = z.object({ id: UuidSchema });

export const ListAgentChatsResponseSchema = z.object({ chats: z.array(AgentChatSchema) });

export type ListAgentChatsResponse = z.infer<typeof ListAgentChatsResponseSchema>;

export const AgentChatDetailSchema = z.object({
    chat: AgentChatSchema,
    messages: z.array(AgentMessageSchema),
    /** True while a run is in progress; the source of truth for the "working" state. */
    running: z.boolean(),
});

export type AgentChatDetail = z.infer<typeof AgentChatDetailSchema>;

export const AgentUndoRequestSchema = z.object({
    audit_id: UuidSchema,
});

export type AgentUndoRequest = z.infer<typeof AgentUndoRequestSchema>;

export const AgentUndoResponseSchema = z.object({
    ok: z.boolean(),
    output: z.unknown().optional(),
});

export type AgentUndoResponse = z.infer<typeof AgentUndoResponseSchema>;
