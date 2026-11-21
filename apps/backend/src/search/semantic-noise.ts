import { sql, type Expression } from 'kysely';
import { db } from '../db/kysely';
import type { ModelRef } from '../embeddings/embedding.repository';
import { excludeTrashed } from '../services/privacy';

/**
 * Where a query's noise ends, so a meaning match has to stand out instead of clearing one fixed number.
 *
 * Embedding models put unrelated text and images at very different similarity levels (siglip2 text-to-image
 * good matches score around 0.10-0.17, bge-m3 plausible ones 0.45-0.66; the noise levels below them are
 * assumed to be roughly 0.03 and 0.27 until measured with `scripts/semantic-probe.ts`), and the level moves with
 * the language and the phrasing of the query. So a hit is judged against the similarities the same query gets
 * across the library: the library is almost entirely unrelated to any one query, so its middle is that
 * query's noise level and its spread is the noise width. The rule leans on that: a query that matches a large
 * share of the library (say "screenshot" when a third of the images are screenshots) moves the median and
 * widens the spread, so the meaning stream keeps little for it and full text answers alone.
 *
 * Median and IQR / 1.349 (a normal distribution's sigma) stand in for mean and standard deviation because the
 * few real matches in the library pull a mean and a standard deviation upward but barely move a median and a
 * quartile range. A hit is kept when it clears both:
 * - `minSimilarity`, an absolute floor per model that only stops pure noise on a library whose spread is tiny;
 * - a number of sigmas above the median that grows with the library (`toRequiredZ`).
 * Both fold into one number, the query's cutoff.
 */

export interface NoiseStats {
    /** Embeddings of the model in the library: how many noise draws a query's top hit is the best of. */
    total: number;
    /** Embeddings the median and spread were taken over: all of them, or a fixed subset of a big library. */
    sample: number;
    median: number;
    /** Robust standard deviation of the similarities. */
    sigma: number;
    /** How long taking the statistics took. */
    elapsedMs: number;
}

export interface CutoffRule {
    minSimilarity: number;
    /** Standard deviations added to the noise's expected maximum, for tails heavier than a normal's (see `toRequiredZ`). */
    marginZ: number;
}

/** Below this many embeddings the noise can't be estimated, so only the absolute floor applies. */
export const MIN_NOISE_SAMPLE = 50;
/** Embeddings the statistics are taken over at most: a median and quartiles from this many are within ~0.03 sigma of the library's. */
export const NOISE_SAMPLE_SIZE = 5_000;
/** A library of near-identical similarities would give sigma ~0 and keep everything above the median. */
const MIN_SIGMA = 0.005;
/** Sigmas per inter-quartile range of a normal distribution. */
const IQR_PER_SIGMA = 1.349;

export function toNoiseStats(total: number, sample: number, quartiles: readonly [number, number, number], elapsedMs = 0): NoiseStats {
    const [q1, median, q3] = quartiles;

    return { total, sample, median, sigma: Math.max((q3 - q1) / IQR_PER_SIGMA, MIN_SIGMA), elapsedMs };
}

/**
 * Sigmas above the median a hit needs. Every embedding is one draw of noise, so the best of N pure-noise draws lands
 * about sqrt(2 ln N) sigmas above the median if the noise is normal: a fixed number of sigmas would let more and more
 * noise through as the library grows, and a query with no real match would keep its best noise. Similarity noise
 * has heavier tails than a normal, though (simulated with a Student-t of 20 degrees of freedom the plain bound
 * lets the best noise through for most queries, and about 1 in 20 still crosses it 1.5 sigmas higher), hence
 * `marginZ` on top.
 */
export function toRequiredZ(marginZ: number, total: number): number {
    return Math.sqrt(2 * Math.log(Math.max(total, 2))) + marginZ;
}

export interface Cutoff {
    /** The similarity a hit must reach. */
    similarity: number;
    /** Sigmas above the median it was set at, null when the library was too small to tell and only the absolute floor applies. */
    z: number | null;
}

/** The cutoff for this query. `stats` is null when the library has no embeddings to compare. */
export function toCutoff(rule: CutoffRule, stats: NoiseStats | null): Cutoff {
    if (!stats || stats.sample < MIN_NOISE_SAMPLE) return { similarity: rule.minSimilarity, z: null };

    const z = toRequiredZ(rule.marginZ, stats.total);

    return { similarity: Math.max(rule.minSimilarity, stats.median + z * stats.sigma), z };
}

interface StatsRow {
    total: number | null;
    sample: number;
    quartiles: number[] | null;
}

export interface NoiseScope {
    userId: string;
}

/** Median and quartiles of the query's similarity to the sampled embeddings, with the full count taken before the sample was cut. */
async function summarise(sampled: Expression<unknown>, literal: string, started: number): Promise<NoiseStats | null> {
    const result = await sql<StatsRow>`
        SELECT max(s.total) AS total, count(*)::int AS sample,
            percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY 1 - (s.embedding <=> ${literal}::vector)) AS quartiles
        FROM (${sampled}) AS s`.execute(db);
    const row = result.rows[0];
    const [q1, median, q3] = row?.quartiles ?? [];

    if (!row || row.total === null || q1 === undefined || median === undefined || q3 === undefined) return null;

    return toNoiseStats(row.total, row.sample, [q1, median, q3], Date.now() - started);
}

const TOTAL = sql<number>`count(*) OVER ()::int`.as('total');
/** Text embeddings are cut per chunk, not per document: a few long documents must not fill the whole sample. */
const BY_CHUNK_ORDER = sql`hashtext(e.document_id::text || ':' || e.chunk_index::text)`;
const BY_DOCUMENT_ORDER = sql`hashtext(e.document_id::text)`;

/**
 * The statistics over the user's embeddings of the model, the same whoever asks and however the query is filtered:
 * the noise level belongs to the model and the query, so a folder filter, an unlocked private folder or the agent's
 * photo guard must not move the cutoff (the vectors themselves are filtered as always, only these aggregates are not).
 *
 * A big library is cut to a fixed subset first (ordered by a hash, so it is the same on every search and cheap: only
 * the sampled vectors are compared with the query). `count(*) OVER ()` runs before the limit. `sampleSize` is a
 * parameter for tests.
 */
export function fetchTextNoise(ref: ModelRef, literal: string, scope: NoiseScope, sampleSize = NOISE_SAMPLE_SIZE): Promise<NoiseStats | null> {
    const sampled = excludeTrashed(db.selectFrom('documents as d'), 'd.')
        .innerJoin('document_text_embeddings as e', 'e.document_id', 'd.id')
        .where('d.user_id', '=', scope.userId)
        .where('e.model', '=', ref.model)
        .where('e.model_version', '=', ref.version)
        .select(['e.embedding as embedding', TOTAL])
        .orderBy(BY_CHUNK_ORDER)
        .orderBy('e.document_id')
        .orderBy('e.chunk_index')
        .limit(sampleSize);

    return summarise(sampled, literal, Date.now());
}

/** Same statistics over the image embeddings (one per document). */
export function fetchImageNoise(ref: ModelRef, literal: string, scope: NoiseScope, sampleSize = NOISE_SAMPLE_SIZE): Promise<NoiseStats | null> {
    const sampled = excludeTrashed(db.selectFrom('documents as d'), 'd.')
        .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
        .where('d.user_id', '=', scope.userId)
        .where('e.model', '=', ref.model)
        .where('e.model_version', '=', ref.version)
        .select(['e.embedding as embedding', TOTAL])
        .orderBy(BY_DOCUMENT_ORDER)
        .orderBy('e.document_id')
        .limit(sampleSize);

    return summarise(sampled, literal, Date.now());
}
