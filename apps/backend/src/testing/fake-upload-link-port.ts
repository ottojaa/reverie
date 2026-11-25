import type { UploadLinkPort } from '../tools/upload-link.store';

/** An in-memory upload link store with a clock the test moves forward, so expiry needs no real waiting. */
export function createFakeUploadLinkPort(): UploadLinkPort & {
    advance: (seconds: number) => void;
    entries: Map<string, { value: string; expiresAt: number }>;
} {
    const entries = new Map<string, { value: string; expiresAt: number }>();
    let now = 0;

    return {
        entries,
        advance: (seconds) => {
            now += seconds * 1000;
        },
        set: async (key, value, ttlSeconds) => {
            entries.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
        },
        take: async (key) => {
            const entry = entries.get(key);

            entries.delete(key);

            return entry && entry.expiresAt > now ? entry.value : null;
        },
    };
}
