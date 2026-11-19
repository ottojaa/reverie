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

export const ServerSettingResponseSchema = z.object({
    setting: ServerSettingSchema,
});

export type ServerSettingResponse = z.infer<typeof ServerSettingResponseSchema>;
