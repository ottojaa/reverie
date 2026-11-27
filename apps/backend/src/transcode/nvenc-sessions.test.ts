import { describe, expect, it } from 'vitest';
import { RUNG_NAMES } from './ladder';
import { toBackgroundNvencSessions, type NvencShare } from './nvenc-sessions';

const COUNTS = [1, 2, 3];
const LIMITS = Array.from({ length: 13 }, (_, limit) => limit);

const ALL_SHARES: NvencShare[] = LIMITS.flatMap((limit) =>
    COUNTS.flatMap((normalEncodes) => COUNTS.map((backgroundEncodes) => ({ limit, normalEncodes, backgroundEncodes }))),
);

describe('toBackgroundNvencSessions', () => {
    it.each([
        // limit, normal encodes, background encodes, sessions per background encode
        [5, 1, 1, 2],
        [8, 1, 1, 5],
        [3, 1, 1, 0],
        [0, 1, 1, 0],
        [5, 2, 1, 0],
        [5, 1, 2, 1],
        [8, 1, 2, 2],
    ])('with a limit of %i, %i normal and %i background encodes gives each background one %i', (limit, normalEncodes, backgroundEncodes, expected) => {
        expect(toBackgroundNvencSessions({ limit, normalEncodes, backgroundEncodes })).toBe(expected);
    });

    it.each(ALL_SHARES)('leaves every normal encode a full ladder: %o', (share) => {
        const normalNeed = share.normalEncodes * RUNG_NAMES.length;
        const backgroundMost = share.backgroundEncodes * toBackgroundNvencSessions(share);

        // When the normal lane alone is over the limit, the background lane takes nothing at all.
        expect(backgroundMost).toBeLessThanOrEqual(Math.max(0, share.limit - normalNeed));
    });
});
