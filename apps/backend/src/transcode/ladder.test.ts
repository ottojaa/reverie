import { describe, expect, it } from 'vitest';
import { decideLadder, type SourceFacts } from './ladder';

const SDR: SourceFacts = {
    width: 1920,
    height: 1080,
    rotation: 0,
    frameRate: 30,
    isHdr: false,
    colorTransfer: null,
    colorSpace: null,
    pixelFormat: null,
    hasAudio: true,
};

const sizes = (source: Partial<SourceFacts>) => decideLadder({ ...SDR, ...source }).rungs.map((rung) => `${rung.width}x${rung.height}`);

describe('decideLadder', () => {
    it('gives a 1080p source all three rungs', () => {
        expect(sizes({})).toEqual(['1920x1080', '1280x720', '852x480']);
    });

    it('gives a 4K source the same three rungs and never a 4K one', () => {
        expect(sizes({ width: 3840, height: 2160 })).toEqual(['1920x1080', '1280x720', '852x480']);
    });

    it('never upscales: a 720p source gets 720 and 480', () => {
        expect(sizes({ width: 1280, height: 720 })).toEqual(['1280x720', '852x480']);
    });

    it('gives a source below 480p one rung at its own size', () => {
        expect(sizes({ width: 640, height: 360 })).toEqual(['640x360']);
    });

    it('rounds an odd-sized source down to even dimensions', () => {
        expect(sizes({ width: 321, height: 241 })).toEqual(['320x240']);
    });

    it('names a portrait clip by its shorter side and keeps it upright', () => {
        expect(sizes({ width: 1080, height: 1920 })).toEqual(['1080x1920', '720x1280', '480x852']);
    });

    describe('rotation', () => {
        it.each([90, 270])('swaps the coded size of a clip rotated %i degrees', (rotation) => {
            // Coded landscape, shown portrait.
            expect(sizes({ rotation })).toEqual(['1080x1920', '720x1280', '480x852']);
            expect(decideLadder({ ...SDR, rotation }).rotated).toBe(true);
        });

        it('leaves a clip rotated 180 degrees the same shape', () => {
            expect(sizes({ rotation: 180 })).toEqual(['1920x1080', '1280x720', '852x480']);
            expect(decideLadder({ ...SDR, rotation: 180 }).rotated).toBe(true);
        });

        it('does not flag an unrotated clip', () => {
            expect(decideLadder(SDR).rotated).toBe(false);
        });
    });

    describe('HDR and SDR', () => {
        it('picks the same rungs: HDR changes the colour handling, not the sizes', () => {
            const hdr = decideLadder({ ...SDR, isHdr: true, colorTransfer: 'arib-std-b67' });

            expect(hdr.rungs).toEqual(decideLadder(SDR).rungs);
        });
    });

    describe('frame rate', () => {
        it('keeps a 60 fps clip as it is', () => {
            expect(decideLadder({ ...SDR, frameRate: 60 }).frameRateCap).toBeNull();
        });

        it('caps a 240 fps slow-motion clip at 60', () => {
            expect(decideLadder({ ...SDR, frameRate: 240 }).frameRateCap).toBe(60);
        });

        it('keeps an unknown frame rate', () => {
            expect(decideLadder({ ...SDR, frameRate: null }).frameRateCap).toBeNull();
        });
    });

    it('gives each lower rung a lower bitrate, with a ceiling above the target', () => {
        const { rungs } = decideLadder(SDR);

        expect(rungs.map((rung) => rung.bitrate)).toEqual([...rungs.map((rung) => rung.bitrate)].sort((a, b) => b - a));
        expect(rungs.every((rung) => rung.maxrate > rung.bitrate && rung.bufsize >= rung.maxrate)).toBe(true);
    });
});
