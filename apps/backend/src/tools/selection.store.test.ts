import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSelectionPort } from '../testing/fake-selection-port';
import { createSelection, loadSelection, SELECTION_TTL_SECONDS, setSelectionPort } from './selection.store';

const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

describe('selection store', () => {
    const port = createFakeSelectionPort();

    beforeEach(() => setSelectionPort(port));
    afterEach(() => setSelectionPort(null));

    it('returns the ids that were stored', async () => {
        const id = await createSelection('user-a', IDS);

        expect(await loadSelection('user-a', id)).toEqual(IDS);
    });

    it('refuses another user’s selection with the message an unknown id gets', async () => {
        const id = await createSelection('user-a', IDS);
        const foreign = await loadSelection('user-b', id).catch((error: Error) => error.message);
        const unknown = await loadSelection('user-b', '00000000-0000-4000-8000-0000000000ff').catch((error: Error) => error.message);

        expect(foreign).toBe(unknown);
        expect(foreign).toMatch(/^Selection not found or expired/);
    });

    it('expires after the time to live', async () => {
        const id = await createSelection('user-a', IDS);

        port.advance(SELECTION_TTL_SECONDS - 1);
        expect(await loadSelection('user-a', id)).toEqual(IDS);
        port.advance(2);
        await expect(loadSelection('user-a', id)).rejects.toThrow(/^Selection not found or expired/);
    });
});

describe('selection store on Redis', () => {
    afterEach(() => {
        setSelectionPort(null);
        vi.resetModules();
        vi.doUnmock('../queues/redis.js');
    });

    it('stores the ids under a user-scoped key with an expiry', async () => {
        const set = vi.fn().mockResolvedValue('OK');
        const get = vi.fn().mockResolvedValue(JSON.stringify(IDS));

        vi.doMock('../queues/redis.js', () => ({ getRedisPublisher: () => ({ get, set }) }));

        const store = await import('./selection.store.js');
        const id = await store.createSelection('user-a', IDS);

        expect(set).toHaveBeenCalledWith('tool-selection:user-a:' + id, JSON.stringify(IDS), 'EX', SELECTION_TTL_SECONDS);
        expect(await store.loadSelection('user-a', id)).toEqual(IDS);
        expect(get).toHaveBeenCalledWith('tool-selection:user-a:' + id);
    });
});
