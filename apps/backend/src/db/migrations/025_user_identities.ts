import { Kysely, sql } from 'kysely';

/**
 * External sign-in links for generic OpenID Connect.
 *
 * up(): creates `user_identities`, one row per (provider, subject) that signs in as a user. Nothing is copied into it:
 * `users.google_id` stays and is read as the `google` link (Google's `id` and OIDC `sub` are the same value); the first
 * sign-in through it records the identity row. So existing users keep working, and code that predates this migration
 * is unaffected (it never reads the table), which lets the migration deploy ahead of the code.
 *
 * down(): drops the table. Identities recorded since (by a link or by email) are lost; users and `google_id` are untouched.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`
        CREATE TABLE user_identities (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider text NOT NULL,
            subject text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (provider, subject),
            UNIQUE (user_id, provider)
        )
    `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS user_identities`.execute(db);
}
