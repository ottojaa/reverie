import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time upload links: a secret that lets one HTTP request add files to one folder, for an MCP
 * client, whose tool calls cannot carry file bytes. Redis holds only the secret's hash, for a short
 * time, and claiming a link removes it in the same command.
 */

export const UPLOAD_LINK_TTL_SECONDS = 15 * 60;

export interface UploadLink {
    userId: string;
    folderId: string;
}

/** The two Redis operations the store needs, so tests can swap in a fake with a clock. */
export interface UploadLinkPort {
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    /** Read and delete in one step, so only one of two racing callers gets the value. */
    take(key: string): Promise<string | null>;
}

interface StoredLink {
    user_id: string;
    folder_id: string;
}

function toKey(secret: string): string {
    return 'upload-link:' + createHash('sha256').update(secret).digest('hex');
}

async function createRedisPort(): Promise<UploadLinkPort> {
    // Loaded lazily: the Redis module validates the server environment on import.
    const { getRedisPublisher } = await import('../queues/redis.js');
    const redis = getRedisPublisher();

    return {
        set: async (key, value, ttlSeconds) => {
            await redis.set(key, value, 'EX', ttlSeconds);
        },
        take: (key) => redis.getdel(key),
    };
}

let port: UploadLinkPort | null = null;

/** Replace the backing store (tests). Pass null to go back to Redis. */
export function setUploadLinkPort(next: UploadLinkPort | null): void {
    port = next;
}

async function getPort(): Promise<UploadLinkPort> {
    port ??= await createRedisPort();

    return port;
}

export async function createUploadLink(link: UploadLink): Promise<{ secret: string; expiresAt: Date }> {
    const secret = randomBytes(32).toString('base64url');
    const stored: StoredLink = { user_id: link.userId, folder_id: link.folderId };
    const expiresAt = new Date(Date.now() + UPLOAD_LINK_TTL_SECONDS * 1000);

    await (await getPort()).set(toKey(secret), JSON.stringify(stored), UPLOAD_LINK_TTL_SECONDS);

    return { secret, expiresAt };
}

/** Use up a link: its target the first time, null for an unknown, expired or already used secret. */
export async function claimUploadLink(secret: string): Promise<UploadLink | null> {
    const raw = await (await getPort()).take(toKey(secret));

    if (raw === null) return null;

    const stored = JSON.parse(raw) as StoredLink;

    return { userId: stored.user_id, folderId: stored.folder_id };
}
