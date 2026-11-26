import sensible from '@fastify/sensible';
import type { LockSecret } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import authPlugin from '../app/plugins/auth.js';
import errorHandler from '../app/plugins/error-handler.js';
import rateLimitPlugin from '../app/plugins/rate-limit.js';
import foldersRoute from '../app/routes/folders.route.js';
import vaultRoute from '../app/routes/vault.route.js';
import type { Database } from '../db/schema.js';
import { hashPassword } from '../services/auth.service.js';

/**
 * The app behind the lock-secret tests: the real vault routes with the app's rate limiter, everything it logs kept in
 * `logged`, and browser sessions that hold their own vault cookie. The test file mocks `db/kysely` and the env.
 */

export const ACCOUNT_PASSWORD = 'correct horse battery staple';
export const PIN: LockSecret = { kind: 'pin', value: '4821' };
export const LOCK_PASSWORD: LockSecret = { kind: 'password', value: 'quiet-lantern-harbour' };

export const STOPPED_BODY = {
    statusCode: 403,
    error: 'invalid_credentials',
    message: 'Too many wrong tries. Enter your account password.',
    details: { ask: 'account_password', tries_left: null },
};

export interface LockApp {
    app: FastifyInstance;
    logged: string[];
}

export async function startLockApp(): Promise<LockApp> {
    const logged: string[] = [];
    const app = Fastify({ logger: { level: 'trace', stream: { write: (line: string) => void logged.push(line) } } });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    for (const plugin of [sensible, rateLimitPlugin, authPlugin, errorHandler]) await app.register(plugin);
    for (const route of [foldersRoute, vaultRoute]) await app.register(route);
    await app.ready();

    return { app, logged };
}

let addresses = 0;

/** A new client address each time, so the per-address rate limit does not stand in for the count of tries. */
function toNewAddress(): string {
    addresses += 1;

    return `10.${Math.floor(addresses / 65536) % 256}.${Math.floor(addresses / 256) % 256}.${addresses % 256}`;
}

interface RequestOptions {
    payload?: object | string;
    headers?: Record<string, string>;
    address?: string;
}

/** A browser session: a login token, and the vault cookie the server sets. */
export class LockSession {
    cookie: string | undefined;

    constructor(
        private readonly app: FastifyInstance,
        private readonly userId: string,
    ) {}

    get token(): string {
        return this.app.jwt.sign({ sub: this.userId, email: 'x@example.test' });
    }

    async request(method: 'GET' | 'POST' | 'PUT', url: string, options: RequestOptions = {}) {
        const response = await this.app.inject({
            method,
            url,
            payload: options.payload,
            remoteAddress: options.address ?? toNewAddress(),
            headers: {
                authorization: 'Bearer ' + this.token,
                ...(this.cookie ? { cookie: 'vault_session=' + this.cookie } : {}),
                ...options.headers,
            },
        });
        const set = response.cookies.find((cookie) => cookie.name === 'vault_session');

        if (set) this.cookie = set.value || undefined;

        return { status: response.statusCode, raw: response.body, body: JSON.parse(response.body), cookieSet: !!set };
    }

    status = async () => (await this.request('GET', '/vault/status')).body;
    unlock = (folderId: string, password: string) => this.request('POST', '/vault/unlock', { payload: { password, folder_id: folderId } });
    save = (secret: LockSecret | null, accountPassword = ACCOUNT_PASSWORD) =>
        this.request('PUT', '/vault/secret', { payload: { account_password: accountPassword, secret } });
    /** Whether this session gets into the folder. */
    canOpen = async (folderId: string) => (await this.request('GET', '/folders/' + folderId + '/children')).status === 200;
}

/** The user as before any lock secret: an account password and no row. */
export async function resetLock(db: Kysely<Database>, userId: string, accountHash?: string): Promise<void> {
    await db.deleteFrom('folder_lock_secrets').where('user_id', '=', userId).execute();
    await db
        .updateTable('users')
        .set({ password_hash: accountHash ?? (await hashPassword(ACCOUNT_PASSWORD)) })
        .where('id', '=', userId)
        .execute();
}

export function fetchLockRow(db: Kysely<Database>, userId: string) {
    return db.selectFrom('folder_lock_secrets').selectAll().where('user_id', '=', userId).executeTakeFirst();
}

export async function setWrongTries(db: Kysely<Database>, userId: string, wrongTries: number): Promise<void> {
    await db.updateTable('folder_lock_secrets').set({ wrong_tries: wrongTries }).where('user_id', '=', userId).execute();
}
