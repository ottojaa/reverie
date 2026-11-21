import type { ParsedQuery } from '@reverie/shared';
import { sql, type CompiledQuery } from 'kysely';
import { env } from '../config/env';
import { db } from '../db/kysely';
import { toVectorLiteral, type ModelRef } from '../embeddings/embedding.repository';
import { createMlClient, MlUnavailableError, type MlClient, type MlModelInfo } from '../embeddings/ml.client';
import { applySearchFilters, buildPrefixTsQuery, documentJoins, type SearchQueryBase } from './filter-application';
import { fetchImageNoise, fetchTextNoise, toCutoff, type Cutoff, type CutoffRule, type NoiseStats } from './semantic-noise';

/**
 * Search by meaning: embeds the query, asks pgvector for the nearest documents on two streams (text
 * by the text model, images by the image model's text tower) and fuses them with full-text ranking.
 * A hit counts only when it stands out from what the same query scores across the library
 * (semantic-noise.ts), so each query and model gets its own cutoff.
 *
 * Every vector query starts from the same filtered documents query as full text (user, private
 * folders, trash and every `type:`/`date:`/`folder:` filter), so a vector hit can never show what a
 * full-text hit could not. When reverie-ml is off, down or slow the matches come back inactive and
 * callers carry on with full text alone; nothing here throws for an ML problem.
 */

export interface SemanticConfig {
    /** What a document must reach to count as a meaning match, per model: an absolute floor and a margin above the query's noise. */
    text: CutoffRule;
    image: CutoffRule;
    /** Most documents kept per stream. */
    topK: number;
    /** After an ML failure, how long to skip ML entirely so searches don't each wait out the timeout. */
    breakerMs: number;
}

export interface SemanticMatches {
    active: boolean;
    /** Document ids the text stream found, most similar first. */
    text: string[];
    /** Document ids the image stream found, most similar first. */
    image: string[];
    /** Every id either stream found. */
    ids: string[];
    /** How many full-text rows a fusion needs: past this rank full text can no longer outscore the weakest meaning match. */
    fullTextDepth: number;
}

export interface SemanticScope {
    userId: string;
    privateFolderIds: string[];
    /** The documents query the vector streams start from; defaults to all documents. The agent's search passes a guarded one. */
    semanticBase?: SearchQueryBase;
}

export interface ScoredHit {
    id: string;
    /** Best cosine similarity of any of the document's vectors to the query. */
    similarity: number;
}

/** One stream's candidates for a query and where its noise ends: the hits at or above `cutoff` are the stream's matches. */
export interface StreamProbe {
    noise: NoiseStats | null;
    cutoff: Cutoff;
    /** Nearest documents the stream looked at, most similar first, kept or not. */
    hits: ScoredHit[];
}

export interface SemanticProbe {
    text: StreamProbe;
    image: StreamProbe;
}

export interface SemanticSearch {
    load(parsed: ParsedQuery, scope: SemanticScope): Promise<SemanticMatches>;
    /** What `load` saw before cutting, for tuning the cutoffs. Null when meaning search can't answer this query now. */
    probe(parsed: ParsedQuery, scope: SemanticScope): Promise<SemanticProbe | null>;
}

interface QueryVector {
    ref: ModelRef;
    literal: string;
}

interface NearestRow {
    id: string;
    distance: number;
}

/** Text chunks fetched per wanted document: a long document has many chunks that can fill the top of the list. */
const CHUNK_OVERFETCH = 5;
const RRF_K = 60;
/** Full text counts double: an exact word match must stay ahead of documents that only sit near the query. */
const FULL_TEXT_WEIGHT = 2;
const VECTOR_WEIGHT = 1;

const toModelRef = (model: MlModelInfo): ModelRef => ({ model: model.name, version: model.revision });
const toFullTextDepth = (topK: number) => 2 * topK + RRF_K;

function toInactive(topK: number): SemanticMatches {
    return { active: false, text: [], image: [], ids: [], fullTextDepth: toFullTextDepth(topK) };
}

function isEligible(parsed: ParsedQuery): boolean {
    if (!parsed.fullText || !buildPrefixTsQuery(parsed.fullText)) return false;

    return parsed.searchScope !== 'filename' && parsed.searchScope !== 'content' && parsed.searchScope !== 'summary';
}

/** Best similarity per document, most similar first. */
function toBestPerDocument(rows: NearestRow[]): ScoredHit[] {
    const best = new Map<string, number>();

    for (const row of rows) {
        const similarity = 1 - row.distance;

        if (similarity > (best.get(row.id) ?? -Infinity)) best.set(row.id, similarity);
    }

    return [...best].map(([id, similarity]) => ({ id, similarity })).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
}

const toMatchIds = (stream: StreamProbe, topK: number): string[] =>
    stream.hits
        .filter((hit) => hit.similarity >= stream.cutoff.similarity)
        .slice(0, topK)
        .map((hit) => hit.id);

/**
 * Runs a vector query in a transaction with iterative index scans on. A filtered HNSW query otherwise
 * stops after ef_search candidates and the filters can leave it with none. `relaxed_order` may return
 * rows slightly out of order, which is why callers sort again. The query is compiled first so that it
 * runs on the transaction's connection: `SET LOCAL` applies to that connection only.
 */
export async function executeNearest<O>(query: { compile(): CompiledQuery<O> }): Promise<O[]> {
    const compiled = query.compile();

    return db.transaction().execute(async (trx) => {
        await sql`SET LOCAL hnsw.iterative_scan = relaxed_order`.execute(trx);

        return (await trx.executeQuery(compiled)).rows;
    });
}

function filteredBase(parsed: ParsedQuery, scope: SemanticScope): SearchQueryBase {
    return applySearchFilters(scope.semanticBase ?? documentJoins(), parsed, scope.userId, scope.privateFolderIds, new Set(['fullText']));
}

function nearestText(parsed: ParsedQuery, scope: SemanticScope, query: QueryVector, rows: number): Promise<NearestRow[]> {
    const distance = sql<number>`e.embedding <=> ${query.literal}::vector`;

    return executeNearest(
        filteredBase(parsed, scope)
            .innerJoin('document_text_embeddings as e', 'e.document_id', 'd.id')
            .where('e.model', '=', query.ref.model)
            .where('e.model_version', '=', query.ref.version)
            .select(['d.id', distance.as('distance')])
            .orderBy('distance')
            .limit(rows),
    );
}

function nearestImage(parsed: ParsedQuery, scope: SemanticScope, query: QueryVector, rows: number): Promise<NearestRow[]> {
    const distance = sql<number>`e.embedding <=> ${query.literal}::vector`;

    return executeNearest(
        filteredBase(parsed, scope)
            .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
            .where('e.model', '=', query.ref.model)
            .where('e.model_version', '=', query.ref.version)
            .select(['d.id', distance.as('distance')])
            .orderBy('distance')
            .limit(rows),
    );
}

export function createSemanticSearch(ml: MlClient | null, config: SemanticConfig, now: () => number = Date.now): SemanticSearch {
    let unavailableUntil = 0;

    /** The query as a vector for each model, or null when ML can't answer now. */
    async function embedQuery(text: string): Promise<{ text: QueryVector; image: QueryVector } | null> {
        if (!ml || now() < unavailableUntil) return null;

        try {
            const [textResult, imageResult] = await Promise.all([ml.embedTexts([text], 'query'), ml.embedImageTexts([text])]);
            const textVector = textResult.embeddings[0];
            const imageVector = imageResult.embeddings[0];

            if (!textVector || !imageVector) return null;

            return {
                text: { ref: toModelRef(textResult.model), literal: toVectorLiteral(textVector) },
                image: { ref: toModelRef(imageResult.model), literal: toVectorLiteral(imageVector) },
            };
        } catch (error) {
            // A refused query (too long, say) says nothing about the service; only an unreachable or erroring one trips the breaker.
            if (error instanceof MlUnavailableError) unavailableUntil = now() + config.breakerMs;

            return null;
        }
    }

    /** Both streams for a query, or null when the query isn't eligible or ML can't answer now. */
    async function probe(parsed: ParsedQuery, scope: SemanticScope): Promise<SemanticProbe | null> {
        if (!isEligible(parsed)) return null;

        const vectors = await embedQuery(parsed.fullText!);

        if (!vectors) return null;

        const noiseScope = { userId: scope.userId };
        const [textRows, imageRows, textNoise, imageNoise] = await Promise.all([
            nearestText(parsed, scope, vectors.text, config.topK * CHUNK_OVERFETCH),
            nearestImage(parsed, scope, vectors.image, config.topK),
            fetchTextNoise(vectors.text.ref, vectors.text.literal, noiseScope),
            fetchImageNoise(vectors.image.ref, vectors.image.literal, noiseScope),
        ]);

        return {
            text: { noise: textNoise, cutoff: toCutoff(config.text, textNoise), hits: toBestPerDocument(textRows) },
            image: { noise: imageNoise, cutoff: toCutoff(config.image, imageNoise), hits: toBestPerDocument(imageRows) },
        };
    }

    return {
        probe,
        async load(parsed, scope) {
            const found = await probe(parsed, scope);

            if (!found) return toInactive(config.topK);

            const text = toMatchIds(found.text, config.topK);
            const image = toMatchIds(found.image, config.topK);

            return { active: true, text, image, ids: [...new Set([...text, ...image])], fullTextDepth: toFullTextDepth(config.topK) };
        },
    };
}

export interface FusionInput {
    /** Full-text matches, best first. */
    fullText: readonly string[];
    text: readonly string[];
    image: readonly string[];
}

/**
 * Weighted reciprocal-rank fusion. Scores are integers so ties are exact; a tie goes to the document
 * the words match, then to the better full-text rank. Full text counts double, so a document only the meaning
 * found (at most 2/61 from its two streams) can at best tie the top word match, and loses the tie. What can happen is
 * that a weaker word match that both meaning streams rank highly (2/62 + 2/61) passes the top word match.
 * `wordMatches` holds every document the words match, including ones too deep in `fullText` to be listed.
 */
export function fuseRankings(input: FusionInput, wordMatches: ReadonlySet<string>): string[] {
    const scores = new Map<string, number>();
    const fullTextRank = new Map(input.fullText.map((id, index) => [id, index]));
    const add = (ids: readonly string[], weight: number) =>
        ids.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + weight * Math.round(1e9 / (RRF_K + index + 1))));

    add(input.fullText, FULL_TEXT_WEIGHT);
    add(input.text, VECTOR_WEIGHT);
    add(input.image, VECTOR_WEIGHT);

    return [...scores.keys()].sort(
        (a, b) =>
            scores.get(b)! - scores.get(a)! ||
            Number(wordMatches.has(b)) - Number(wordMatches.has(a)) ||
            (fullTextRank.get(a) ?? Infinity) - (fullTextRank.get(b) ?? Infinity) ||
            a.localeCompare(b),
    );
}

let instance: SemanticSearch | undefined;

/** The shared instance, built from the environment on first use. Without ML_URL it never matches anything. */
export function getSemanticSearch(): SemanticSearch {
    instance ??= createSemanticSearch(env.ML_URL ? createMlClient(env.ML_URL, env.SEMANTIC_TIMEOUT_MS) : null, {
        text: { minSimilarity: env.SEMANTIC_TEXT_MIN_SIMILARITY, marginZ: env.SEMANTIC_TEXT_MARGIN_Z },
        image: { minSimilarity: env.SEMANTIC_IMAGE_MIN_SIMILARITY, marginZ: env.SEMANTIC_IMAGE_MARGIN_Z },
        topK: env.SEMANTIC_TOP_K,
        breakerMs: 10_000,
    });

    return instance;
}

/** Swap the shared instance (tests). Pass undefined to go back to the environment's. */
export function setSemanticSearch(next: SemanticSearch | undefined): void {
    instance = next;
}
