import { Kysely } from 'kysely';

/**
 * Drop users.hide_private.
 *
 * The private-items vault was reworked from an app-wide hide/reveal (gated by this
 * per-user toggle) to a per-resource lock: private items always appear in listings, but
 * their content is withheld until the vault is unlocked. `is_private` alone is now the
 * lock flag, so the global toggle is obsolete.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('users').dropColumn('hide_private').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable('users')
        .addColumn('hide_private', 'boolean', (col) => col.notNull().defaultTo(false))
        .execute();
}
