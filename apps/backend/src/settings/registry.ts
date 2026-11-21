import { LlmProviderSchema } from '@reverie/shared';
import { z } from 'zod';
import { env } from '../config/env.js';

interface SettingDefinition<S extends z.ZodTypeAny> {
    /** Decides what a valid value is; used for admin writes and when reading a stored row. */
    schema: S;
    /** Shown to the admin next to the setting. */
    description: string;
    /** Value used when no row overrides the setting. Read lazily so env changes in tests apply. */
    getDefault: () => z.infer<S>;
}

function defineSetting<S extends z.ZodTypeAny>(definition: SettingDefinition<S>): SettingDefinition<S> {
    return definition;
}

const ModelSetting = z.string({ invalid_type_error: 'Must be text' }).trim().min(1, 'A model name is required').max(200, 'Must be at most 200 characters');

/** A server's OpenAI-style root, such as http://ollama:11434/v1. Empty means none is set, which Anthropic does not need. */
const BaseUrlSetting = z
    .string({ invalid_type_error: 'Must be text' })
    .trim()
    .max(500, 'Must be at most 500 characters')
    .refine((value) => value === '' || /^https?:\/\/[^\s/]+/i.test(value), 'Must be an http(s) URL such as http://ollama:11434/v1');

/**
 * Every server setting an admin can change at runtime. Add an entry here and it shows up in the
 * admin API and settings page; no other wiring is needed. Schemas must stay strict (no coercion):
 * the API stores exactly what it validated.
 */
export const settingsRegistry = {
    'trash.retentionDays': defineSetting({
        schema: z
            .number({ invalid_type_error: 'Must be a whole number' })
            .int('Must be a whole number')
            .min(1, 'Must be at least 1')
            .max(3650, 'Must be at most 3650'),
        description: 'How many days a deleted item stays in the trash before it is removed for good.',
        getDefault: () => env.TRASH_RETENTION_DAYS,
    }),
    // The AI providers are live: the next job reads them. The API key of a local server stays in the environment (LOCAL_LLM_API_KEY).
    'llm.summary.provider': defineSetting({
        schema: LlmProviderSchema,
        description: 'Where summaries and tags come from: Anthropic (Claude), or a local server that speaks the OpenAI chat-completions API.',
        getDefault: () => 'anthropic' as const,
    }),
    'llm.summary.model': defineSetting({
        schema: ModelSetting,
        description: "The model that writes summaries: a Claude model id, or the local server's model name.",
        getDefault: () => env.ANTHROPIC_SUMMARY_MODEL,
    }),
    'llm.summary.baseUrl': defineSetting({
        schema: BaseUrlSetting,
        description: "Root URL of the local server's OpenAI-style API (for example http://ollama:11434/v1). Unused by Anthropic.",
        getDefault: () => '',
    }),
    'llm.image.provider': defineSetting({
        schema: LlmProviderSchema,
        description: 'Where image understanding comes from: Anthropic (Claude), or a local server that speaks the OpenAI chat-completions API.',
        getDefault: () => 'anthropic' as const,
    }),
    'llm.image.model': defineSetting({
        schema: ModelSetting,
        description: "The model that looks at images: a Claude model id, or the local server's vision model name.",
        getDefault: () => env.ANTHROPIC_VISION_MODEL,
    }),
    'llm.image.baseUrl': defineSetting({
        schema: BaseUrlSetting,
        description: "Root URL of the local server's OpenAI-style API (for example http://ollama:11434/v1). Unused by Anthropic.",
        getDefault: () => '',
    }),
    'llm.image.enabled': defineSetting({
        schema: z.boolean({ invalid_type_error: 'Must be true or false' }),
        description:
            'Whether the model sees images. Off, an image is only summarised from its OCR text. Photos, private items and images with camera data never reach it either way.',
        getDefault: () => env.LLM_VISION_ENABLED,
    }),
};

export type SettingKey = keyof typeof settingsRegistry;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsRegistry)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
    return Object.hasOwn(settingsRegistry, key);
}
