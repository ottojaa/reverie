import { describe, expect, it } from 'vitest';
import { isTokenRefusal, toQualityLabel, toQualityLevels, toSetKey } from './hls-playback';

const KEY = 'a'.repeat(64);

describe('toQualityLabel', () => {
    it('names a landscape rung by its height', () => {
        expect(toQualityLabel({ width: 1920, height: 1080 })).toBe('1080p');
    });

    it('names a portrait rung by its width, the shorter side', () => {
        expect(toQualityLabel({ width: 720, height: 1280 })).toBe('720p');
    });

    it('falls back to the bitrate when the playlist gives no size', () => {
        expect(toQualityLabel({ bitrate: 2_500_000 })).toBe('2500 kbps');
    });
});

describe('toQualityLevels', () => {
    it('lists the best rung first and keeps each rung’s own index', () => {
        const levels = toQualityLevels([{ height: 480 }, { height: 720 }, { height: 1080 }]);

        expect(levels.map((l) => [l.index, l.label])).toEqual([
            [2, '1080p'],
            [1, '720p'],
            [0, '480p'],
        ]);
    });
});

describe('toSetKey', () => {
    it('is the same for two signings of one set', () => {
        expect(toSetKey(`/files/hls/100/abc/${KEY}/master.m3u8`)).toBe(KEY);
        expect(toSetKey(`https://api.example.dev/files/hls/200/xyz/${KEY}/master.m3u8`)).toBe(KEY);
    });

    it('is null for no URL or one that is not a rendition set', () => {
        expect(toSetKey(null)).toBeNull();
        expect(toSetKey('/files/2024/clip.mp4?e=1&s=2')).toBeNull();
    });
});

describe('isTokenRefusal', () => {
    it('is true for an expired or rejected token only', () => {
        expect([403, 410, 404, 500, undefined].map(isTokenRefusal)).toEqual([true, true, false, false, false]);
    });
});
