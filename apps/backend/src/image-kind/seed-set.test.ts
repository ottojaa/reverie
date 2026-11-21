import { describe, expect, it } from 'vitest';
import { IMAGE_KINDS, type ImageKind } from './kinds';
import { blendScores, scorePrototypes, toUnit, type SeedKind } from './prototypes';
import { buildSeedSet, scoreWithSeedSet, type SnapshotImage } from './seed-set';

const CONFIG = { k: 3, promptWeight: 0.25 };

/** A small deterministic generator, so the library is the same on every run. */
function makeRandom(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;

        return state / 4294967296;
    };
}

function makeLibrary(): { images: SnapshotImage[]; promptRaws: Record<ImageKind, number>[] } {
    const random = makeRandom(7);
    const vector = () => Array.from({ length: 8 }, () => random() - 0.5);
    const kinds: (SeedKind | null)[] = [
        ...Array<SeedKind>(5).fill('photo'),
        ...Array<SeedKind>(5).fill('screenshot'),
        ...Array<SeedKind>(4).fill('document'),
        ...Array<SeedKind>(2).fill('receipt'),
        null,
        null,
    ];
    const images = kinds.map((kind, i) => ({ id: 'image-' + i, embedding: vector(), rules: kind ? [kind] : [] }));
    const promptRaws = images.map(() => Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, 0.05 + random() * 0.2])) as Record<ImageKind, number>);

    return { images, promptRaws };
}

describe('buildSeedSet', () => {
    it('keeps the seeds of the kinds that have enough of them, with unit-length embeddings, and scores the rest by prompts alone', () => {
        const { images, promptRaws } = makeLibrary();
        const set = buildSeedSet(images, promptRaws, CONFIG);

        expect(set.stats.scored).toEqual(['photo', 'screenshot', 'document']);
        expect(set.seeds).toHaveLength(14);
        expect(set.seeds.some((seed) => seed.kind === 'receipt')).toBe(false);
        expect(set.seeds.every((seed) => Math.abs(Math.hypot(...seed.embedding) - 1) < 1e-9)).toBe(true);
        expect(Object.keys(set.stats.prototype).sort()).toEqual(['document', 'photo', 'screenshot']);
        expect(Object.keys(set.stats.prompt).sort()).toEqual([...IMAGE_KINDS].sort());
    });
});

describe('scoreWithSeedSet', () => {
    it('gives each image the score the tuner printed for it: the same blend over the same library', () => {
        const { images, promptRaws } = makeLibrary();
        const set = buildSeedSet(images, promptRaws, CONFIG);
        const expected = blendScores(scorePrototypes(images, { method: 'knn', k: CONFIG.k }).sims, promptRaws, CONFIG.promptWeight);

        images.forEach((image, i) => {
            const scores = scoreWithSeedSet(image.embedding, image.id, promptRaws[i]!, set, CONFIG);

            for (const kind of IMAGE_KINDS) expect(scores[kind]).toBeCloseTo(expected[i]![kind], 9);
        });
    });

    it('leaves out a near-duplicate of the image among the seeds of its kind, as the tuner does', () => {
        const { images, promptRaws } = makeLibrary();
        const twin: SnapshotImage = { id: 'twin', embedding: images[0]!.embedding.map((value) => value * 1.001), rules: ['photo'] };
        const withTwin = [...images, twin];
        const raws = [...promptRaws, promptRaws[0]!];
        const set = buildSeedSet(withTwin, raws, CONFIG);
        const expected = blendScores(scorePrototypes(withTwin, { method: 'knn', k: CONFIG.k }).sims, raws, CONFIG.promptWeight);
        const scores = scoreWithSeedSet(images[0]!.embedding, images[0]!.id, promptRaws[0]!, set, CONFIG);

        expect(scores.photo).toBeCloseTo(expected[0]!.photo, 9);
    });

    it('gives a kind without seeds only its weighted prompt term, and no chance at all when the prompt weight is 0', () => {
        const { images, promptRaws } = makeLibrary();
        const set = buildSeedSet(images, promptRaws, CONFIG);
        const raw = promptRaws[0]!;
        const withPrompts = scoreWithSeedSet(images[0]!.embedding, null, raw, set, CONFIG);
        const without = scoreWithSeedSet(images[0]!.embedding, null, raw, set, { k: 3, promptWeight: 0 });
        const { mean, std } = set.stats.prompt.receipt;

        expect(withPrompts.receipt).toBeCloseTo((0.25 * (raw.receipt - mean)) / std, 9);
        expect(without.receipt).toBe(Number.NEGATIVE_INFINITY);
        expect(Number.isFinite(without.photo)).toBe(true);
    });

    it('does not move when the library grows: the score is a function of the frozen set', () => {
        const { images, promptRaws } = makeLibrary();
        const set = buildSeedSet(images, promptRaws, CONFIG);
        const probe = toUnit(images[3]!.embedding.map((value, i) => value + (i % 2 ? 0.1 : -0.1)));
        const before = scoreWithSeedSet(probe, null, promptRaws[3]!, set, CONFIG);

        // A new photo arriving in the library is not in the set, so nothing about the probe's score changes.
        buildSeedSet([...images, { id: 'newcomer', embedding: probe, rules: ['photo'] }], [...promptRaws, promptRaws[3]!], CONFIG);

        expect(scoreWithSeedSet(probe, null, promptRaws[3]!, set, CONFIG)).toEqual(before);
    });
});
