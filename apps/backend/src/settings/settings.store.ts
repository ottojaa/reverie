import { db } from '../db/kysely.js';
import type { ServerSetting } from '../db/schema.js';

export function fetchSettingRow(key: string): Promise<ServerSetting | undefined> {
    return db.selectFrom('server_settings').selectAll().where('key', '=', key).executeTakeFirst();
}

export function fetchSettingRows(): Promise<ServerSetting[]> {
    return db.selectFrom('server_settings').selectAll().execute();
}

export async function upsertSettingRow(key: string, value: unknown, updatedBy: string): Promise<void> {
    // jsonb needs an explicit JSON string: node-pg would send a bare string value as invalid JSON.
    const json = JSON.stringify(value);
    const updatedAt = new Date();

    await db
        .insertInto('server_settings')
        .values({ key, value: json, updated_at: updatedAt, updated_by: updatedBy })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: updatedAt, updated_by: updatedBy }))
        .execute();
}

export async function deleteSettingRow(key: string): Promise<void> {
    await db.deleteFrom('server_settings').where('key', '=', key).execute();
}

/** Writes and resets several settings in one transaction, so a reader sees all of them changed or none. */
export async function applySettingRows(upserts: { key: string; value: unknown }[], deletes: string[], updatedBy: string): Promise<void> {
    const updatedAt = new Date();

    await db.transaction().execute(async (trx) => {
        for (const { key, value } of upserts) {
            // jsonb needs an explicit JSON string, as in upsertSettingRow.
            const json = JSON.stringify(value);

            await trx
                .insertInto('server_settings')
                .values({ key, value: json, updated_at: updatedAt, updated_by: updatedBy })
                .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: updatedAt, updated_by: updatedBy }))
                .execute();
        }

        if (deletes.length > 0) await trx.deleteFrom('server_settings').where('key', 'in', deletes).execute();
    });
}
