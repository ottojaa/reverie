import { AppError, type LockAsk, type LockSecret, type LockSecretKind, type VaultRefusal } from '@reverie/shared';
import type { Kysely } from 'kysely';
import { db } from '../db/kysely.js';
import type { Database } from '../db/schema.js';
import { hashPassword, verifyPassword } from './auth.service.js';

/**
 * The lock secret: a PIN or password of its own that opens a user's private folders, in place of the account password.
 * Only this module reads or writes `folder_lock_secrets`. No hash and no count of tries leaves it, and nothing typed
 * is logged.
 *
 * Tries at the lock secret are counted per user. After LOCK_TRY_LIMIT wrong ones it is stopped: only the account
 * password is taken, until it is given at the lock or a secret is saved. A right lock secret gives back its own try
 * and no other, so someone holding a session gets no fresh guesses from its owner's unlocks. Wrong account passwords
 * are not counted, so nobody can be shut out for good.
 *
 * `generation` goes up with every save. A vault cookie opens nothing once the generation it was signed under is past.
 */

const LOCK_TRY_LIMIT = 10;

const SECRET_NAMES: Record<LockSecretKind, string> = { pin: 'PIN', password: 'password' };

export interface LockSecretState {
    /** False when there is no such user. */
    exists: boolean;
    /** Whether folder locks apply: without an account password there is nothing to open or reset them with. */
    enforced: boolean;
    secretKind: LockSecretKind | null;
    /** What a prompt must ask for now; null when locks do not apply. */
    ask: LockAsk | null;
    generation: number;
}

interface TakenTry {
    kind: LockSecretKind;
    secret_hash: string;
    wrong_tries: number;
    generation: number;
}

/** A refused try or save. A 403, because clients answer a 401 by renewing the login and sending the request again. */
class LockRefusalError extends AppError {
    constructor(message: string, details: VaultRefusal['details']) {
        super(403, 'invalid_credentials', message, details);
    }
}

function toStoppedError(): LockRefusalError {
    return new LockRefusalError('Too many wrong tries. Enter your account password.', { ask: 'account_password', tries_left: null });
}

function toWrongTryError(kind: LockSecretKind, triesLeft: number): LockRefusalError {
    if (triesLeft === 0) return toStoppedError();

    return new LockRefusalError(`Incorrect ${SECRET_NAMES[kind]}. Tries left: ${triesLeft}`, { ask: kind, tries_left: triesLeft });
}

/** The user with their lock secret's row, all of it read in one statement so its parts belong together. */
function selectUserLock(userId: string, conn: Kysely<Database>) {
    return conn.selectFrom('users').leftJoin('folder_lock_secrets as lock', 'lock.user_id', 'users.id').where('users.id', '=', userId);
}

function fetchPasswordAndLock(userId: string) {
    return selectUserLock(userId, db).select(['users.password_hash', 'lock.kind', 'lock.wrong_tries', 'lock.generation']).executeTakeFirst();
}

type PasswordAndLock = Awaited<ReturnType<typeof fetchPasswordAndLock>>;

export async function fetchLockSecretState(userId: string, conn: Kysely<Database> = db): Promise<LockSecretState> {
    const row = await selectUserLock(userId, conn)
        .select((eb) => [eb('users.password_hash', 'is not', null).as('has_password'), 'lock.kind', 'lock.wrong_tries', 'lock.generation'])
        .executeTakeFirst();
    const generation = row?.generation ?? 0;

    if (!row?.has_password) return { exists: !!row, enforced: false, secretKind: null, ask: null, generation };

    const ask = row.kind && (row.wrong_tries ?? 0) < LOCK_TRY_LIMIT ? row.kind : 'account_password';

    return { exists: true, enforced: true, secretKind: row.kind, ask, generation };
}

/** Counts a try before anything is compared, in one statement, so tries sent at once cannot pass the limit. */
function takeTry(userId: string): Promise<TakenTry | undefined> {
    return db
        .updateTable('folder_lock_secrets')
        .set((eb) => ({ wrong_tries: eb('wrong_tries', '+', 1) }))
        .where('user_id', '=', userId)
        .where('kind', 'is not', null)
        .where('wrong_tries', '<', LOCK_TRY_LIMIT)
        .returning(['kind', 'secret_hash', 'wrong_tries', 'generation'])
        .$narrowType<{ kind: LockSecretKind; secret_hash: string }>()
        .executeTakeFirst();
}

async function checkLockSecret(userId: string, taken: TakenTry, typed: string): Promise<{ generation: number }> {
    if (!(await verifyPassword(typed, taken.secret_hash))) throw toWrongTryError(taken.kind, LOCK_TRY_LIMIT - taken.wrong_tries);

    // The try was right, so it is given back, unless a save has started the count over since.
    await db
        .updateTable('folder_lock_secrets')
        .set((eb) => ({ wrong_tries: eb('wrong_tries', '-', 1) }))
        .where('user_id', '=', userId)
        .where('generation', '=', taken.generation)
        .where('wrong_tries', '>', 0)
        .execute();

    return { generation: taken.generation };
}

/** For a user with no lock secret, or a stopped one. */
async function checkAccountPassword(userId: string, row: PasswordAndLock, typed: string): Promise<{ generation: number }> {
    const isRight = !!row?.password_hash && (await verifyPassword(typed, row.password_hash));

    // With no lock secret a wrong password gets the 401 installed apps know.
    if (!isRight) throw row?.kind ? toStoppedError() : new AppError(401, 'invalid_credentials', 'Incorrect password');

    const generation = row?.generation ?? 0;

    if (row?.kind) {
        await db.updateTable('folder_lock_secrets').set({ wrong_tries: 0 }).where('user_id', '=', userId).where('generation', '=', generation).execute();
    }

    return { generation };
}

async function checkTyped(userId: string, typed: string, mayStartOver: boolean): Promise<{ generation: number }> {
    const taken = await takeTry(userId);

    if (taken) return checkLockSecret(userId, taken, typed);

    const row = await fetchPasswordAndLock(userId);

    // A secret with tries left here was saved, or got its tries back, after the update above found none.
    const hasTriesNow = !!row?.kind && (row.wrong_tries ?? 0) < LOCK_TRY_LIMIT;

    if (hasTriesNow && mayStartOver) return checkTyped(userId, typed, false);

    return checkAccountPassword(userId, row, typed);
}

/**
 * Checks what was typed at a lock against the one secret the state's `ask` names, and returns the generation of the
 * secret it was checked against. Throws when it is wrong.
 */
export function verifyUnlock(userId: string, typed: string): Promise<{ generation: number }> {
    return checkTyped(userId, typed, true);
}

/**
 * Sets, changes or removes (`next` null) the lock secret and starts its count over. Takes the account password, never
 * the old lock secret. Removing keeps the row, so the generation never goes back.
 */
export async function replaceLockSecret(userId: string, accountPassword: string, next: LockSecret | null): Promise<{ generation: number }> {
    const user = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirst();

    if (!user?.password_hash || !(await verifyPassword(accountPassword, user.password_hash))) {
        throw new LockRefusalError('Incorrect account password', { ask: 'account_password', tries_left: null });
    }

    // Both columns are always written together: the database's complaint about one without the other quotes the row.
    const secret = { kind: next?.kind ?? null, secret_hash: next ? await hashPassword(next.value) : null };

    return (
        db
            .insertInto('folder_lock_secrets')
            // A cookie signed with no generation counts as 0, so the first save is already 1.
            .values({ user_id: userId, ...secret, generation: 1 })
            .onConflict((conflict) =>
                conflict.column('user_id').doUpdateSet((eb) => ({
                    ...secret,
                    wrong_tries: 0,
                    generation: eb('folder_lock_secrets.generation', '+', 1),
                    updated_at: new Date(),
                })),
            )
            .returning('generation')
            .executeTakeFirstOrThrow()
    );
}
