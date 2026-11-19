import type { SelectionPort } from '../tools/selection.store';

/** An in-memory selection store with a clock the test moves forward, so expiry needs no real waiting. */
export function createFakeSelectionPort(): SelectionPort & { advance: (seconds: number) => void } {
    const entries = new Map<string, { value: string; expiresAt: number }>();
    let now = 0;

    return {
        advance: (seconds) => {
            now += seconds * 1000;
        },
        get: async (key) => {
            const entry = entries.get(key);

            return entry && entry.expiresAt > now ? entry.value : null;
        },
        set: async (key, value, ttlSeconds) => {
            entries.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
        },
    };
}
