import { z } from 'zod';
import { DateStringSchema, UuidSchema } from './common.js';

// One server setting as the admin sees it. `value` and `default` are JSON: their shape is
// defined by the setting's own schema on the backend, so the contract only says "JSON".
export const ServerSettingSchema = z.object({
    key: z.string(),
    description: z.string(),
    value: z.unknown(),
    default: z.unknown(),
    // True when an admin override is stored; false when `value` is the default.
    overridden: z.boolean(),
    updated_at: DateStringSchema.nullable(),
    updated_by: UuidSchema.nullable(),
});

export type ServerSetting = z.infer<typeof ServerSettingSchema>;

export const ListServerSettingsResponseSchema = z.object({
    settings: z.array(ServerSettingSchema),
});

export type ListServerSettingsResponse = z.infer<typeof ListServerSettingsResponseSchema>;

export const ServerSettingParamsSchema = z.object({
    // Dotted key such as `trash.retentionDays`.
    key: z.string().min(1).max(100),
});

export const UpdateServerSettingRequestSchema = z.object({
    value: z.unknown(),
});

export type UpdateServerSettingRequest = z.infer<typeof UpdateServerSettingRequestSchema>;

/** Several settings written together: a capability's provider, model and URL must change as one, or a running job sees a mix. */
export const UpdateServerSettingsRequestSchema = z.object({
    set: z.record(z.string(), z.unknown()).default({}),
    reset: z.array(z.string()).default([]),
});

export type UpdateServerSettingsRequest = z.infer<typeof UpdateServerSettingsRequestSchema>;

export const ServerSettingResponseSchema = z.object({
    setting: ServerSettingSchema,
});

export type ServerSettingResponse = z.infer<typeof ServerSettingResponseSchema>;

// Where a background AI capability sends its requests. `openai-compatible` is any server that speaks the OpenAI
// chat-completions API (Ollama, llama.cpp, vLLM, LM Studio).
export const LlmProviderSchema = z.enum(['anthropic', 'openai-compatible']);

export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmCapabilitySchema = z.enum(['summary', 'image']);

export type LlmCapability = z.infer<typeof LlmCapabilitySchema>;

// The draft the admin typed, not what is saved: settings apply to real jobs at once, so a server is tried before it is saved.
export const TestLlmConnectionRequestSchema = z.object({
    capability: LlmCapabilitySchema,
    provider: LlmProviderSchema,
    model: z.string().max(200),
    base_url: z.string().max(500),
});

export type TestLlmConnectionRequest = z.infer<typeof TestLlmConnectionRequestSchema>;

// Always a 200: a server that is down or answers wrongly is the result being asked for, not an API failure.
export const TestLlmConnectionResponseSchema = z.object({
    ok: z.boolean(),
    provider: LlmProviderSchema,
    model: z.string(),
    latency_ms: z.number(),
    // What the model answered, when it answered.
    reply: z.string().nullable(),
    error: z.string().nullable(),
});

export type TestLlmConnectionResponse = z.infer<typeof TestLlmConnectionResponseSchema>;
