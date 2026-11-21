import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_KINDS } from './kinds';
import { marginsFor, measureKindStats, parsePromptArgs, parsePromptSet, resolveCalibration, toConfig, type PromptSet } from './prompt-set';

const prompts = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, [`a ${kind}`]]));
const base = {
    name: 't',
    aggregate: 'max',
    calibration: 'none',
    thresholds: { cameraPrior: 0, screenPrior: 0, margin: 0.1, paperOnCameraMargin: 0.2 },
    prompts,
};

describe('parsePromptSet', () => {
    it('reads a complete set', () => {
        expect(parsePromptSet(base)).toMatchObject({ name: 't', aggregate: 'max', calibration: 'none' });
    });

    it.each([
        ['a missing kind', { ...base, prompts: { photo: ['a photo'] } }, /exactly the kinds/],
        ['an unknown kind', { ...base, prompts: { ...prompts, cat: ['a cat'] } }, /exactly the kinds/],
        ['an empty prompt list', { ...base, prompts: { ...prompts, photo: [] } }, /prompts/],
        ['an unknown aggregate', { ...base, aggregate: 'median' }, /aggregate/],
        ['a calibration with a missing kind', { ...base, calibration: { photo: { offset: 0, scale: 1 } } }, /calibration must have exactly the kinds/],
        ['a zero scale', { ...base, calibration: Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, { offset: 0, scale: 0 }])) }, /scale/],
        [
            'more prompts than reverie-ml takes in one request',
            { ...base, prompts: { ...prompts, photo: Array.from({ length: 65 }, (_, i) => 'p' + i) } },
            /at most 64/,
        ],
    ])('refuses %s', (_name, json, message) => {
        expect(() => parsePromptSet(json)).toThrow(message);
    });
});

describe('calibration', () => {
    const raws = [
        { photo: 0.1, screenshot: 0.2, document: 0.3, receipt: 0.4, diagram: 0.5, other: 0.5 },
        { photo: 0.3, screenshot: 0.2, document: 0.1, receipt: 0.4, diagram: 0.1, other: 0.5 },
    ];
    const stats = measureKindStats(raws);

    it('measures the mean and the (population) standard deviation of each kind', () => {
        expect(stats.photo.mean).toBeCloseTo(0.2);
        expect(stats.photo.std).toBeCloseTo(0.1);
        expect(stats.receipt.std).toBe(0);
    });

    it('leaves raw scores alone for none, centres them for offset, and standardises them for zscore', () => {
        expect(resolveCalibration('none', stats).photo).toEqual({ offset: 0, scale: 1 });
        expect(resolveCalibration('offset', stats).photo).toEqual({ offset: stats.photo.mean, scale: 1 });
        expect(resolveCalibration('zscore', stats).photo).toEqual({ offset: stats.photo.mean, scale: stats.photo.std });
    });

    it('does not divide by zero for a kind whose score never varies', () => {
        expect(resolveCalibration('zscore', stats).receipt.scale).toBe(1);
    });

    it('takes explicit numbers as they are', () => {
        const explicit = Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, { offset: 1, scale: 2 }])) as PromptSet['calibration'];

        expect(resolveCalibration(explicit, stats)).toBe(explicit);
    });

    it('builds a classifier config named after the set', () => {
        const set = parsePromptSet(base);

        expect(toConfig(set, resolveCalibration(set.calibration, stats))).toMatchObject({ version: 't', aggregate: 'max', thresholds: base.thresholds });
    });

    it('tries z-sized margins after a z-score and cosine-sized ones otherwise, unless the set lists its own', () => {
        expect(marginsFor(parsePromptSet({ ...base, calibration: 'zscore' }))[0]).toBeGreaterThanOrEqual(0.25);
        expect(marginsFor(parsePromptSet(base))[0]).toBeLessThan(0.05);
        expect(marginsFor(parsePromptSet({ ...base, margins: [7] }))).toEqual([7]);
    });
});

describe('parsePromptArgs', () => {
    it('collects every --prompts value and ignores the rest', () => {
        expect(parsePromptArgs(['--prompts', 'a.json', '--other', '--prompts', 'b.json'])).toEqual(['a.json', 'b.json']);
        expect(parsePromptArgs(['--prompts'])).toEqual([]);
    });
});

describe('the committed prompt sets', () => {
    const directory = join(__dirname, '../../scripts/image-kind-sets');
    const files = readdirSync(directory).filter((file) => file.endsWith('.json'));

    it('has at least two sets', () => {
        expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it.each(files)('%s parses and is named after its file', (file) => {
        expect(parsePromptSet(JSON.parse(readFileSync(join(directory, file), 'utf8'))).name).toBe(file.replace(/\.json$/, ''));
    });
});
