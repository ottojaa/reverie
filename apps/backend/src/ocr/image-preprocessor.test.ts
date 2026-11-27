import sharp, { type Sharp } from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preprocessImage } from './image-preprocessor';

/** Noise over a gradient: enough detail that two compression levels write different files. */
function toTestImage(width: number, height: number, channels: 3 | 4): Sharp {
    const pixels = Buffer.alloc(width * height * channels);

    for (let i = 0; i < pixels.length; i++) pixels[i] = ((i % (width * channels)) / channels + ((i * 7919) % 31)) % 256;

    return sharp(pixels, { raw: { width, height, channels } });
}

async function decode(image: Buffer) {
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height, channels: info.channels };
}

/** The same preprocessing, written with sharp's default PNG settings. */
async function preprocessWithDefaultPng(image: Buffer): Promise<Buffer> {
    const prototype = Object.getPrototypeOf(sharp()) as Sharp;
    const { png } = prototype;
    const spy = vi.spyOn(prototype, 'png').mockImplementation(function (this: Sharp) {
        return png.call(this);
    });
    const result = await preprocessImage(image);
    spy.mockRestore();

    return result;
}

describe('the image handed to OCR', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['an oversized photo, downscaled', toTestImage(4800, 3600, 3).jpeg()],
        ['a screenshot with alpha, upscaled', toTestImage(1170, 2532, 4).png()],
        ['a mid-sized image, left at its size', toTestImage(2400, 1600, 3).webp()],
    ])('decodes to the same pixels as with default PNG compression: %s', async (_name, source) => {
        const image = await source.toBuffer();

        const handed = await preprocessImage(image);
        const reference = await preprocessWithDefaultPng(image);

        expect(handed.equals(reference)).toBe(false);
        const [actual, expected] = await Promise.all([decode(handed), decode(reference)]);
        expect({ ...actual, data: undefined }).toEqual({ ...expected, data: undefined });
        expect(actual.data.equals(expected.data)).toBe(true);
    });
});
