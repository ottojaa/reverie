import { describe, expect, it } from 'vitest';
import { decideKind } from './classifier';
import { IDENTITY_CALIBRATION } from './classifier-config';
import { IMAGE_KINDS, type ImageKind } from './kinds';
import { blendScores, DUPLICATE_COSINE, matchSeedRules, MIN_SEEDS, scorePrototypes, toSeedKind, type SeedFacts, type SeedKind } from './prototypes';

function facts(extra: Partial<SeedFacts> = {}): SeedFacts {
    return { filename: 'x.jpg', category: null, hasMeaningfulText: false, camera: [], width: 100, height: 100, ...extra };
}

describe('toSeedKind', () => {
    it('takes a Screenshot_ file without camera evidence as a screenshot seed', () => {
        expect(toSeedKind(facts({ filename: 'Screenshot_2026-01-02.jpg' }))).toBe('screenshot');
    });

    it('takes an exact screen size without camera evidence as a screenshot seed', () => {
        expect(toSeedKind(facts({ width: 1920, height: 1080 }))).toBe('screenshot');
    });

    it('never takes an image with camera evidence as a screenshot seed', () => {
        expect(toSeedKind(facts({ filename: 'Screenshot_1.jpg', hasMeaningfulText: true, camera: ['make'] }))).toBeNull();
        expect(toSeedKind(facts({ width: 1920, height: 1080, camera: ['gps'] }))).toBe('photo');
    });

    it('takes camera evidence without meaningful text as a photo seed', () => {
        expect(toSeedKind(facts({ camera: ['model'] }))).toBe('photo');
    });

    it('takes the language model category for paper, including a photographed statement', () => {
        expect(toSeedKind(facts({ category: 'bank_statement', hasMeaningfulText: true }))).toBe('document');
        expect(toSeedKind(facts({ category: 'stock_statement', hasMeaningfulText: true, camera: ['make'] }))).toBe('document');
        expect(toSeedKind(facts({ category: 'receipt', hasMeaningfulText: true }))).toBe('receipt');
    });

    it('does not seed from the screenshot category, which is the bar, nor from other, photo or no category', () => {
        expect(toSeedKind(facts({ category: 'screenshot' }))).toBeNull();
        expect(toSeedKind(facts({ category: 'other', hasMeaningfulText: true }))).toBeNull();
        expect(toSeedKind(facts({ category: 'photo' }))).toBeNull();
    });

    it('lists every rule an image matches, the first one deciding', () => {
        expect(matchSeedRules(facts({ filename: 'Screenshot_1.png', category: 'invoice', hasMeaningfulText: true }))).toEqual(['document', 'screenshot']);
    });
});

describe('scorePrototypes', () => {
    // Directions in a plane, by angle. Seeds of one kind are at least 15 degrees apart, which keeps them from counting as
    // near-duplicates (cosine 0.99 is about 8 degrees).
    const at = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180), 0];
    const seed = (kind: SeedKind, degrees: number) => ({ embedding: at(degrees), rules: [kind] });
    const cosine = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
    const sum = (vectors: number[][]) => vectors.reduce((total, v) => total.map((value, d) => value + v[d]!), [0, 0, 0]);
    const normed = (v: number[]) => v.map((value) => value / Math.hypot(...v));
    // Three screenshot seeds near 0 degrees, three documents near 100, and a probe between them that is no seed.
    const images = [
        seed('screenshot', 0),
        seed('screenshot', 15),
        seed('screenshot', 30),
        seed('document', 90),
        seed('document', 105),
        seed('document', 120),
        { embedding: at(45), rules: [] as SeedKind[] },
    ];
    const centroid = { method: 'centroid', k: 3 } as const;

    it('counts the seeds per kind', () => {
        expect(scorePrototypes(images, centroid).seedCounts).toMatchObject({ screenshot: 3, document: 3, receipt: 0, photo: 0 });
    });

    it('scores a seed against the other seeds only: it does not vote for itself', () => {
        const { sims } = scorePrototypes(images, centroid);

        expect(sims[0]!.screenshot).toBeCloseTo(cosine(at(0), normed(sum([at(15), at(30)]))), 10);
    });

    it('scores an image that is no seed against every seed', () => {
        const { sims } = scorePrototypes(images, centroid);

        expect(sims[6]!.screenshot).toBeCloseTo(cosine(at(45), normed(sum([at(0), at(15), at(30)]))), 10);
    });

    it('averages the similarity to the k nearest other seeds for knn', () => {
        const { sims } = scorePrototypes(images, { method: 'knn', k: 2 });

        expect(sims[0]!.screenshot).toBeCloseTo((cosine(at(0), at(15)) + cosine(at(0), at(30))) / 2, 10);
    });

    it('leaves out a same-kind near-duplicate and counts the images that had one', () => {
        const twin = seed('screenshot', 0.5);
        const { sims, imagesWithTwins } = scorePrototypes([...images, twin], { method: 'knn', k: 1 });

        expect(cosine(at(0), at(0.5))).toBeGreaterThan(DUPLICATE_COSINE);
        // Seed 0 would match its twin at about 1; without it the nearest is the seed at 15 degrees.
        expect(sims[0]!.screenshot).toBeCloseTo(cosine(at(0), at(15)), 10);
        expect(imagesWithTwins).toBe(2);
    });

    it('does not score a kind with fewer than the minimum number of seeds', () => {
        const { sims } = scorePrototypes([images[0]!, images[1]!, ...images.slice(3)], centroid);

        expect(MIN_SEEDS).toBe(3);
        expect(sims.every((entry) => entry.screenshot === null)).toBe(true);
        expect(sims.every((entry) => entry.document !== null)).toBe(true);
    });
});

describe('blendScores', () => {
    const zeros = (count: number) => Array.from({ length: count }, () => Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, 0])) as Record<ImageKind, number>);
    const sims = [
        { photo: 1, screenshot: 0, document: null, receipt: null },
        { photo: 0, screenshot: 1, document: null, receipt: null },
    ] as Record<SeedKind, number | null>[];

    it('z-scores each kind over the library', () => {
        const rows = blendScores(sims, zeros(2), 0);

        expect(rows[0]!.photo).toBeCloseTo(1, 10);
        expect(rows[1]!.photo).toBeCloseTo(-1, 10);
    });

    it('cannot choose a kind with no prototype scores or prompt term: no NaN, negative infinity', () => {
        const rows = blendScores(sims, zeros(2), 0);

        for (const kind of ['document', 'receipt', 'diagram', 'other'] as const) expect(rows[0]![kind]).toBe(Number.NEGATIVE_INFINITY);
    });

    it('gives such a kind its weighted prompt z-score once the prompts count', () => {
        const prompts = zeros(2);

        prompts[0]!.diagram = 0.1;
        prompts[1]!.diagram = 0.3;

        const rows = blendScores(sims, prompts, 0.5);

        expect(rows[0]!.diagram).toBeCloseTo(-0.5, 10);
        expect(rows[1]!.diagram).toBeCloseTo(0.5, 10);
        expect(rows[0]!.receipt).toBeCloseTo(0, 10);
    });

    it('keeps a doubtful image photo: an unscorable kind never beats it', () => {
        const rows = blendScores(sims, zeros(2), 0);
        const config = {
            version: 't',
            prompts: {} as never,
            aggregate: 'max' as const,
            calibration: IDENTITY_CALIBRATION,
            thresholds: { cameraPrior: 0.75, screenPrior: 0.5, margin: 0.5, paperOnCameraMargin: 1 },
        };
        const noFacts = { camera: [], captureDate: false, width: null, height: null };

        expect(decideKind(rows[0]!, noFacts, config).kind).toBe('photo');
        expect(decideKind(rows[1]!, noFacts, config).kind).toBe('screenshot');
    });
});
