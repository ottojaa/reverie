import { randomUUID } from 'node:crypto';
import { ToolError } from './types';

/**
 * Selections: the id set behind a search, kept server-side so the model passes one short
 * `selection_id` instead of echoing hundreds of UUIDs. They live in Redis, keyed by user, with a
 * TTL; a write tool that receives one still re-checks every id for visibility.
 */

export const SELECTION_TTL_SECONDS = 60 * 60;
export const MAX_SELECTION_SIZE = 5000;

/** The two Redis operations the store needs, so tests can swap in a fake with a clock. */
export interface SelectionPort {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Same message for an unknown, expired or someone else's selection, so it reveals nothing. */
const SELECTION_NOT_FOUND = 'Selection not found or expired: run the search again';

function toKey(userId: string, selectionId: string): string {
    return 'tool-selection:' + userId + ':' + selectionId;
}

async function createRedisPort(): Promise<SelectionPort> {
    // Loaded lazily: the Redis module validates the server environment on import.
    const { getRedisPublisher } = await import('../queues/redis.js');
    const redis = getRedisPublisher();

    return {
        get: (key) => redis.get(key),
        set: async (key, value, ttlSeconds) => {
            await redis.set(key, value, 'EX', ttlSeconds);
        },
    };
}

let port: SelectionPort | null = null;

/** Replace the backing store (tests). Pass null to go back to Redis. */
export function setSelectionPort(next: SelectionPort | null): void {
    port = next;
}

async function getPort(): Promise<SelectionPort> {
    port ??= await createRedisPort();

    return port;
}

export async function createSelection(userId: string, ids: string[]): Promise<string> {
    const selectionId = randomUUID();

    await (await getPort()).set(toKey(userId, selectionId), JSON.stringify(ids), SELECTION_TTL_SECONDS);

    return selectionId;
}

export async function loadSelection(userId: string, selectionId: string): Promise<string[]> {
    const raw = await (await getPort()).get(toKey(userId, selectionId));

    if (raw === null) throw new ToolError(SELECTION_NOT_FOUND);

    return JSON.parse(raw) as string[];
}
