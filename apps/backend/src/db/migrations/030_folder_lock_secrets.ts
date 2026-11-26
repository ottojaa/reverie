import { Kysely, sql } from 'kysely';

/**
 * Folder lock secrets: a PIN or password of its own for a user's private folders, apart from the account password.
 *
 * up(): creates `folder_lock_secrets`, at most one row per user. `kind` says which of the two `secret_hash` is the
 * hash of; both are null on a row that holds no secret, and no row at all means no secret either. `wrong_tries`
 * counts failed guesses and `generation` numbers the versions of the secret. Deleting the user removes the row. No
 * existing table changes, so code that predates this migration is unaffected.
 *
 * down(): drops the table, and with it every lock secret. Nothing else is touched.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE folder_lock_secrets (
            user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            kind text CHECK (kind IN ('pin', 'password')),
            secret_hash text,
            wrong_tries smallint NOT NULL DEFAULT 0,
            generation integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK ((kind IS NULL) = (secret_hash IS NULL))
        )
    `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS folder_lock_secrets`.execute(db);
}
