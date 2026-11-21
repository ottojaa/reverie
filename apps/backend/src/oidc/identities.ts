import { sql } from 'kysely';
import { db } from '../db/kysely.js';
import type { User } from '../db/schema.js';
import type { OidcIdentity } from './oidc-client.js';

/**
 * Which Reverie user a provider's sign-in belongs to, or none. Nobody is ever created here: accounts are made by an
 * admin (or `create-user`), and an unknown person is turned away. In order:
 *
 * 1. the (provider, subject) link recorded by an earlier sign-in;
 * 2. `google` only: the user whose `users.google_id` is this subject, the link Reverie had before OpenID Connect;
 * 3. a user whose email the provider vouches for (`email_verified` true) and who has no link to this provider yet.
 *
 * 2 and 3 record the link, so the next sign-in is a plain 1. A user with a different subject already linked to the
 * provider is never matched by email, so a link cannot be taken over by a second account at the same address.
 * Inactive users are not signed in and not linked.
 */
export async function findUserForIdentity(providerId: string, identity: OidcIdentity): Promise<User | null> {
    const linked = await findLinkedUser(providerId, identity.subject);

    if (linked) return linked.is_active ? linked : null;

    const candidate = (providerId === 'google' ? await findByLegacyGoogleId(identity.subject) : undefined) ?? (await findByVerifiedEmail(providerId, identity));

    if (!candidate?.is_active) return null;

    // A concurrent sign-in may have recorded this very link a moment ago; the conflict is targeted at (provider, subject) so
    // that only that case passes quietly. Another subject racing to link the same user hits (user_id, provider) and throws.
    await db
        .insertInto('user_identities')
        .values({ user_id: candidate.id, provider: providerId, subject: identity.subject })
        .onConflict((oc) => oc.columns(['provider', 'subject']).doNothing())
        .execute();

    // Whoever holds the link now must be this user (the same subject may have been linked to someone else in the meantime).
    const owner = await findLinkedUser(providerId, identity.subject);

    return owner?.id === candidate.id ? candidate : null;
}

function findLinkedUser(providerId: string, subject: string): Promise<User | undefined> {
    return db
        .selectFrom('user_identities')
        .innerJoin('users', 'users.id', 'user_identities.user_id')
        .selectAll('users')
        .where('user_identities.provider', '=', providerId)
        .where('user_identities.subject', '=', subject)
        .executeTakeFirst();
}

function findByLegacyGoogleId(subject: string): Promise<User | undefined> {
    return db.selectFrom('users').selectAll().where('google_id', '=', subject).executeTakeFirst();
}

async function findByVerifiedEmail(providerId: string, identity: OidcIdentity): Promise<User | undefined> {
    if (!identity.emailVerified || !identity.email) return undefined;

    return db
        .selectFrom('users')
        .selectAll()
        .where(sql`lower(email)`, '=', identity.email.toLowerCase())
        .where((eb) =>
            eb.not(
                eb.exists(
                    eb
                        .selectFrom('user_identities')
                        .select('id')
                        .whereRef('user_identities.user_id', '=', 'users.id')
                        .where('user_identities.provider', '=', providerId),
                ),
            ),
        )
        .executeTakeFirst();
}
