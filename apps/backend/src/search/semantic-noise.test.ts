import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import { toVectorLiteral } from '../embeddings/embedding.repository';
import { dbProxy } from '../testing/db-proxy.js';
import { createFakeMl, IMAGE_DIMENSIONS, IMAGE_MODEL, leaning, TEXT_DIMENSIONS, TEXT_MODEL, unit } from '../testing/fake-ml.js';
import { seedDocument, seedUser } from '../testing/seed.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { describeDb } from '../testing/tool-world.js';
import { parseQuery } from './query-parser';
import { fetchImageNoise, fetchTextNoise, MIN_NOISE_SAMPLE, toCutoff, toNoiseStats, toRequiredZ, type CutoffRule, type NoiseStats } from './semantic-noise';
import { createSemanticSearch, type SemanticConfig } from './semantic-rank';

/** The shipped defaults (config/env.ts). */
const TEXT_RULE: CutoffRule = { minSimilarity: 0.35, marginZ: 1.5 };
const IMAGE_RULE: CutoffRule = { minSimilarity: 0.06, marginZ: 1.5 };

/**
 * Synthetic libraries shaped like the real one: a query's similarity to every embedding is noise around a
 * median, with a slightly heavy tail (a Student-t, 20 degrees of freedom, scaled to the stated spread), and a
 * real match is a handful of similarities well above it.
 */
function seededRandom(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function noiseLibrary(size: number, median: number, spread: number, seed: number): number[] {
    const random = seededRandom(seed);
    const df = 20;
    const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

    const student = () => {
        let chi = 0;

        for (let i = 0; i < df; i++) chi += normal() ** 2;

        return normal() / Math.sqrt(chi / df) / Math.sqrt(df / (df - 2));
    };

    return Array.from({ length: size }, () => median + spread * student());
}

/** What the database's percentile_cont gives, for a library held in memory. */
function statsOf(library: number[]): NoiseStats {
    const sorted = [...library].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;

    return toNoiseStats(sorted.length, sorted.length, [at(0.25), at(0.5), at(0.75)]);
}

function kept(hits: number[], rule: CutoffRule, library: number[]): number[] {
    const { similarity } = toCutoff(rule, statsOf(library));

    return hits.filter((hit) => hit >= similarity);
}

const top = (library: number[], n: number) => [...library].sort((a, b) => b - a).slice(0, n);

/** Cosines of `size` embeddings to the query axis: the evenly spaced quantiles of a normal, so no random draw decides a test. */
function noiseCosines(size: number, median: number, spread: number): number[] {
    const inverse = (p: number) => {
        // The normal quantile by bisection on the CDF: plenty for a test fixture.
        let low = -8;
        let high = 8;

        for (let i = 0; i < 60; i++) {
            const mid = (low + high) / 2;
            const cdf = 0.5 * (1 + erf(mid / Math.SQRT2));

            if (cdf < p) low = mid;
            else high = mid;
        }

        return (low + high) / 2;
    };

    return Array.from({ length: size }, (_, i) => median + spread * inverse((i + 0.5) / size));
}

function erf(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));

    return Math.sign(x) * (1 - poly * Math.exp(-x * x));
}

describe('meaning cutoff on synthetic libraries', () => {
    // siglip2 text->image: noise around 0.03, real hits 0.10-0.17.
    const images = noiseLibrary(10_000, 0.03, 0.015, 1);
    // bge-m3 chunks: noise around 0.27, real hits 0.45-0.66, Finnish 0.47-0.59.
    const chunks = noiseLibrary(20_000, 0.27, 0.03, 2);

    it('keeps the image hits that stand out ("sunset at the beach", "bank statement" near 0.13)', () => {
        expect(kept([0.172, 0.155, 0.13, 0.126], IMAGE_RULE, images)).toEqual([0.172, 0.155, 0.13, 0.126]);
    });

    it('keeps the text hits of a plausible query, in either language', () => {
        expect(kept([0.67, 0.61, 0.55], TEXT_RULE, chunks)).toEqual([0.67, 0.61, 0.55]);
        expect(kept([0.59, 0.53, 0.5], TEXT_RULE, chunks)).toEqual([0.59, 0.53, 0.5]);
    });

    it('drops what the noise itself reaches: a query with no real match ("lumi talvi") keeps nothing from either stream', () => {
        // The library's own noise, offered whole as candidates, plus a text top hit of 0.39 as measured on the real library.
        const imageNoise = noiseCosines(10_000, 0.03, 0.015);
        const textNoise = noiseCosines(20_000, 0.27, 0.03);

        expect(Math.max(...textNoise)).toBeCloseTo(0.39, 1);
        expect(kept(top(imageNoise, 100), IMAGE_RULE, imageNoise)).toEqual([]);
        expect(kept([0.39, ...top(textNoise, 100)], TEXT_RULE, textNoise)).toEqual([]);
    });

    it('keeps nothing for nearly all no-match queries even when the noise has a tail heavier than a normal', () => {
        const queries = Array.from({ length: 20 }, (_, seed) => noiseLibrary(10_000, 0.03, 0.015, 1_000 + seed));
        const leaking = queries.filter((library) => kept(top(library, 100), IMAGE_RULE, library).length > 0);

        // Tails of this weight leak for about one query in twenty at this margin (marginZ is the knob to tighten).
        expect(leaking.length).toBeLessThanOrEqual(2);
    });

    it('asks for more sigmas of a bigger library, because the best of more noise draws sits higher', () => {
        expect(toRequiredZ(1.5, 100_000)).toBeGreaterThan(toRequiredZ(1.5, 1_000));
        expect(toCutoff(IMAGE_RULE, statsOf(noiseLibrary(100_000, 0.03, 0.015, 3))).similarity).toBeGreaterThan(
            toCutoff(IMAGE_RULE, statsOf(noiseLibrary(1_000, 0.03, 0.015, 3))).similarity,
        );
    });

    it('follows the model: the same similarity is a match in one scale and noise in another', () => {
        expect(kept([0.13], IMAGE_RULE, images)).toEqual([0.13]);
        expect(kept([0.13], TEXT_RULE, chunks)).toEqual([]);
    });

    it('falls back to the absolute floor when the library is too small to tell what noise is', () => {
        const few = statsOf(noiseLibrary(MIN_NOISE_SAMPLE - 1, 0.03, 0.015, 4));

        expect(toCutoff(IMAGE_RULE, few)).toEqual({ similarity: IMAGE_RULE.minSimilarity, z: null });
        expect(toCutoff(IMAGE_RULE, null)).toEqual({ similarity: IMAGE_RULE.minSimilarity, z: null });
    });

    it('never goes below the absolute floor, and survives a library of identical similarities', () => {
        const flat = statsOf(Array.from({ length: 200 }, () => 0.01));

        expect(flat.sigma).toBeGreaterThan(0);
        expect(toCutoff(IMAGE_RULE, flat).similarity).toBeGreaterThanOrEqual(IMAGE_RULE.minSimilarity);
        expect(toCutoff({ minSimilarity: 0.4, marginZ: 0 }, statsOf(images)).similarity).toBeGreaterThanOrEqual(0.4);
    });
});

const QUERY_AXIS = 1;
const CONFIG: SemanticConfig = { text: TEXT_RULE, image: IMAGE_RULE, topK: 20, breakerMs: 60_000 };
describeDb('meaning cutoff against the database', () => {
    let database: TestDatabase;
    let db: Kysely<Database>;

    beforeAll(async () => {
        database = await createTestDatabase();
        db = database.db;
        dbProxy.use(db);
    }, 60_000);
    afterAll(async () => {
        await database?.close();
    });

    const literal = (dimensions: number) => toVectorLiteral(unit(dimensions, QUERY_AXIS));

    async function addImage(userId: string, name: string, cosine: number, options: { deleted?: boolean; model?: string } = {}) {
        const documentId = await seedDocument(db, { userId, name, deleted: options.deleted });

        await db
            .insertInto('document_image_embeddings')
            .values({
                document_id: documentId,
                content_hash: 'h',
                model: options.model ?? IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, QUERY_AXIS, cosine)),
            })
            .execute();

        return documentId;
    }

    async function addChunks(userId: string, name: string, cosines: number[]) {
        const documentId = await seedDocument(db, { userId, name });

        for (const [index, cosine] of cosines.entries()) {
            await db
                .insertInto('document_text_embeddings')
                .values({
                    document_id: documentId,
                    chunk_index: index,
                    char_start: 0,
                    char_end: 1,
                    content_hash: 'h',
                    model: TEXT_MODEL.name,
                    model_version: TEXT_MODEL.revision,
                    embedding: toVectorLiteral(leaning(TEXT_DIMENSIONS, QUERY_AXIS, cosine)),
                })
                .execute();
        }

        return documentId;
    }

    it('takes the statistics over the user’s own vectors of the model, never trashed ones or other users’', async () => {
        const owner = await seedUser(db, 'stats-owner');
        const other = await seedUser(db, 'stats-other');
        const cosines = noiseCosines(60, 0.1, 0.02);

        for (const [index, cosine] of cosines.entries()) await addImage(owner, `own-${index}.jpg`, cosine);

        await addImage(owner, 'trashed.jpg', 0.9, { deleted: true });
        await addImage(owner, 'old-model.jpg', 0.9, { model: 'other-model' });
        await addImage(other, 'theirs.jpg', 0.9);

        const stats = await fetchImageNoise({ model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision }, literal(IMAGE_DIMENSIONS), { userId: owner });

        expect(stats).toMatchObject({ total: 60, sample: 60 });
        expect(stats!.median).toBeCloseTo(0.1, 3);
        expect(stats!.sigma).toBeCloseTo(0.02, 2);
    });

    it('cuts a big library to a fixed sample but still counts all of it', async () => {
        const owner = await seedUser(db, 'sample-owner');

        await addChunks(owner, 'long.pdf', noiseCosines(80, 0.3, 0.03));

        const ref = { model: TEXT_MODEL.name, version: TEXT_MODEL.revision };
        const first = await fetchTextNoise(ref, literal(TEXT_DIMENSIONS), { userId: owner }, 25);
        const again = await fetchTextNoise(ref, literal(TEXT_DIMENSIONS), { userId: owner }, 25);

        expect(first).toMatchObject({ total: 80, sample: 25 });
        expect(again).toMatchObject({ median: first!.median, sigma: first!.sigma });
    });

    it('has no statistics for a user without embeddings', async () => {
        const nobody = await seedUser(db, 'nobody');

        expect(await fetchImageNoise({ model: IMAGE_MODEL.name, version: IMAGE_MODEL.revision }, literal(IMAGE_DIMENSIONS), { userId: nobody })).toBeNull();
    });

    describe('search', () => {
        async function setUp(label: string) {
            const userId = await seedUser(db, label);
            const ml = createFakeMl();

            ml.setTextVector(label, unit(TEXT_DIMENSIONS, QUERY_AXIS));
            ml.setImageTextVector(label, unit(IMAGE_DIMENSIONS, QUERY_AXIS));

            const load = () => createSemanticSearch(ml, CONFIG).load(parseQuery(label), { userId, privateFolderIds: [] });

            return { userId, load };
        }

        it('keeps the image and text hits that stand out from the noise and drops the strongest noise, though it clears the absolute floor', async () => {
            const { userId, load } = await setUp('sunset');
            const noise = noiseCosines(100, 0.03, 0.015);
            const strongestNoise = Math.max(...noise);

            for (const [index, cosine] of noise.entries()) await addImage(userId, `noise-${index}.jpg`, cosine);

            const match = await addImage(userId, 'beach.jpg', 0.2);
            const noiseDoc = await addImage(userId, 'grain.jpg', strongestNoise + 0.01);
            const textMatch = await addChunks(userId, 'statement.pdf', [0.6, ...noiseCosines(99, 0.27, 0.03)]);

            // The absolute floor (0.06) alone would let the noisiest images in.
            expect(strongestNoise + 0.01).toBeGreaterThan(IMAGE_RULE.minSimilarity);

            const matches = await load();

            expect(matches.image).toEqual([match]);
            expect(matches.image).not.toContain(noiseDoc);
            expect(matches.text).toEqual([textMatch]);
        });

        it('returns no meaning matches for a query nothing in the library is about', async () => {
            const { userId, load } = await setUp('lumi talvi');

            for (const [index, cosine] of noiseCosines(100, 0.03, 0.015).entries()) await addImage(userId, `noise-${index}.jpg`, cosine);

            await addChunks(userId, 'noise.pdf', noiseCosines(100, 0.27, 0.03));

            const matches = await load();

            expect(matches).toMatchObject({ active: true, text: [], image: [], ids: [] });
        });
    });
});
