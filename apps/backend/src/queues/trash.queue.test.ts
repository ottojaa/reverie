import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ upsertJobScheduler: vi.fn(), close: vi.fn() }));

vi.mock('bullmq', () => ({
    Queue: class {
        upsertJobScheduler = h.upsertJobScheduler;
        close = h.close;
    },
}));
vi.mock('./redis', () => ({ getRedisConnectionOptions: () => ({}) }));

import { closeTrashQueue, scheduleTrashPurge, TRASH_PURGE_INTERVAL_MS } from './trash.queue';

describe('scheduleTrashPurge', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await closeTrashQueue();
    });

    it('upserts one repeatable job under a fixed scheduler id', async () => {
        await scheduleTrashPurge();
        await scheduleTrashPurge();

        expect(h.upsertJobScheduler).toHaveBeenCalledTimes(2);
        const [firstId, firstRepeat] = h.upsertJobScheduler.mock.calls[0]!;
        const [secondId] = h.upsertJobScheduler.mock.calls[1]!;

        // Same id on every call: a restart replaces the schedule instead of stacking a second one.
        expect(firstId).toBe(secondId);
        expect(firstRepeat).toEqual({ every: TRASH_PURGE_INTERVAL_MS });
    });
});
