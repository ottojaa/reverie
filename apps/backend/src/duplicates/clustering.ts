/**
 * Groups of near-identical images from pairs of similar images, with complete linkage: two groups merge only when every image of one
 * has a pair with every image of the other. A chain A~B~C where A and C are not similar therefore stays {A,B} and {C}, so a run of
 * near neighbours cannot pull unrelated pictures into one group. A pair that was never stored (below the threshold, or beyond an
 * image's neighbour cap) counts as "not similar".
 *
 * Greedy: pairs are tried strongest first (ties by id), so the result does not depend on the order they are given in.
 */

export interface SimilarPair {
    a: string;
    b: string;
    similarity: number;
}

export interface Cluster {
    /** Member ids, sorted. */
    ids: string[];
    /** The lowest similarity between two members. */
    minSimilarity: number;
}

function toAdjacency(pairs: SimilarPair[]): Map<string, Map<string, number>> {
    const adjacency = new Map<string, Map<string, number>>();

    const link = (from: string, to: string, similarity: number) => {
        const row = adjacency.get(from) ?? new Map<string, number>();

        row.set(to, Math.max(similarity, row.get(to) ?? 0));
        adjacency.set(from, row);
    };

    for (const pair of pairs) {
        link(pair.a, pair.b, pair.similarity);
        link(pair.b, pair.a, pair.similarity);
    }

    return adjacency;
}

function isFullyLinked(adjacency: Map<string, Map<string, number>>, left: string[], right: string[]): boolean {
    return left.every((x) => right.every((y) => adjacency.has(x) && adjacency.get(x)!.has(y)));
}

function toMinSimilarity(adjacency: Map<string, Map<string, number>>, ids: string[]): number {
    let min = Infinity;

    for (const x of ids) for (const y of ids) if (x < y) min = Math.min(min, adjacency.get(x)!.get(y)!);

    return min;
}

export function clusterCompleteLinkage(pairs: SimilarPair[]): Cluster[] {
    const adjacency = toAdjacency(pairs);
    const clusterOf = new Map<string, string[]>();
    const strongestFirst = [...pairs].sort((p, q) => q.similarity - p.similarity || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));

    for (const { a, b } of strongestFirst) {
        const left = clusterOf.get(a) ?? [a];
        const right = clusterOf.get(b) ?? [b];

        if (left === right) continue;

        if (!isFullyLinked(adjacency, left, right)) continue;

        const merged = [...left, ...right];

        for (const id of merged) clusterOf.set(id, merged);
    }

    const clusters = new Set(clusterOf.values());

    return [...clusters]
        .map((members) => ({ ids: [...members].sort(), minSimilarity: toMinSimilarity(adjacency, members) }))
        .sort((p, q) => q.ids.length - p.ids.length || q.minSimilarity - p.minSimilarity || p.ids[0]!.localeCompare(q.ids[0]!));
}
