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
};

export type SettingKey = keyof typeof settingsRegistry;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsRegistry)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
    return Object.hasOwn(settingsRegistry, key);
}
