import type { ServerSetting as ServerSettingItem } from '@reverie/shared';
import { NotFoundError, ValidationError } from '@reverie/shared';
import type { ServerSetting } from '../db/schema.js';
import { isSettingKey, settingsRegistry, type SettingKey, type SettingValue } from './registry.js';
import { applySettingRows, deleteSettingRow, fetchSettingRow, fetchSettingRows, upsertSettingRow } from './settings.store.js';

function assertSettingKey(key: string): asserts key is SettingKey {
    if (!isSettingKey(key)) throw new NotFoundError('Setting ' + key);
}

/** The stored override, or undefined when there is no row or the row no longer passes the schema. */
function toStoredValue<K extends SettingKey>(key: K, row: ServerSetting | undefined): SettingValue<K> | undefined {
    if (!row) return undefined;

    const parsed = settingsRegistry[key].schema.safeParse(row.value);

    if (parsed.success) return parsed.data;

    // The schema was tightened after this value was written. Readers fall back to the default
    // rather than fail; the admin sees the setting as not overridden and can set it again.
    console.warn('Ignoring invalid stored setting: ' + key);

    return undefined;
}

function toItem(key: SettingKey, row: ServerSetting | undefined): ServerSettingItem {
    const definition = settingsRegistry[key];
    const stored = toStoredValue(key, row);
    const defaultValue = definition.getDefault();

    return {
        key,
        description: definition.description,
        value: stored ?? defaultValue,
        default: defaultValue,
        overridden: stored !== undefined,
        updated_at: stored !== undefined && row ? row.updated_at.toISOString() : null,
        updated_by: stored !== undefined && row ? row.updated_by : null,
    };
}

/** Current value of a setting: the admin override if there is one, else the default. Read at use, never cached. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const stored = toStoredValue(key, await fetchSettingRow(key));

    return stored ?? settingsRegistry[key].getDefault();
}

/** Current values of several settings from one read: the admin override of each, else its default. */
export async function getSettings<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
    const rows = new Map((await fetchSettingRows()).map((row) => [row.key, row]));
    const entries = keys.map((key) => [key, toStoredValue(key, rows.get(key)) ?? settingsRegistry[key].getDefault()] as const);

    return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
}

export async function listSettings(): Promise<ServerSettingItem[]> {
    const rows = new Map((await fetchSettingRows()).map((row) => [row.key, row]));

    return (Object.keys(settingsRegistry) as SettingKey[]).map((key) => toItem(key, rows.get(key)));
}

export async function setSetting(key: string, value: unknown, updatedBy: string): Promise<ServerSettingItem> {
    assertSettingKey(key);

    const parsed = settingsRegistry[key].schema.safeParse(value);

    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));

    await upsertSettingRow(key, parsed.data, updatedBy);

    return toItem(key, await fetchSettingRow(key));
}

/**
 * Sets and resets several settings at once, each value checked by its setting's schema first: nothing is written when
 * one is refused. A key in both lists is refused too, since the result would depend on the order.
 */
export async function applySettings(changes: { set: Record<string, unknown>; reset: string[] }, updatedBy: string): Promise<ServerSettingItem[]> {
    const upserts = Object.entries(changes.set).map(([key, value]) => {
        assertSettingKey(key);

        const parsed = settingsRegistry[key].schema.safeParse(value);

        if (!parsed.success) throw new ValidationError(key + ': ' + parsed.error.issues.map((issue) => issue.message).join('; '));

        return { key, value: parsed.data };
    });

    for (const key of changes.reset) assertSettingKey(key);

    if (changes.reset.some((key) => key in changes.set)) throw new ValidationError('A setting cannot be set and reset in one change');

    await applySettingRows(upserts, changes.reset, updatedBy);

    return listSettings();
}

export async function resetSetting(key: string): Promise<ServerSettingItem> {
    assertSettingKey(key);

    await deleteSettingRow(key);

    return toItem(key, undefined);
}
