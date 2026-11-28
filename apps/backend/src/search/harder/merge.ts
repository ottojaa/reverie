/**
 * One page out of several searches' results, by reciprocal-rank fusion with every search weighted alike: the user's
 * own wording counting double would put each find of a single rewording below a full page of what they already saw.
 */
import type { MatchKind } from '@reverie/shared';
import type { RankedEntry } from '../hybrid-search';
import { fuseWeighted } from '../semantic-rank';

/** Why a document matched across the searches that found it; null when none of them searched by meaning. */
function combineMatches(matches: (MatchKind | null)[]): MatchKind | null {
    if (matches.every((match) => match === null)) return null;

    const hasMeaning = matches.some((match) => match === 'meaning' || match === 'both');
    const hasWords = matches.some((match) => match !== 'meaning');

    if (hasMeaning && hasWords) return 'both';

    return hasMeaning ? 'meaning' : 'keywords';
}

/**
 * The documents that get a place whatever their score: the user's best hit, and each rewording's best hit that the
 * user's own search missed. Without this, enough documents that several searches agree on would crowd out the very
 * file only one wording finds.
 */
function toAssuredIds(own: RankedEntry[], rewordings: RankedEntry[][]): Set<string> {
    const ownIds = new Set(own.map((entry) => entry.id));

    return rewordings.reduce(
        (assured, entries) => {
            const find = entries.find((entry) => !ownIds.has(entry.id) && !assured.has(entry.id));

            return find ? new Set([...assured, find.id]) : assured;
        },
        new Set(own.slice(0, 1).map((entry) => entry.id)),
    );
}

/** Every search's entry for each document. */
function groupById(searches: RankedEntry[][]): Map<string, RankedEntry[]> {
    const found = new Map<string, RankedEntry[]>();

    for (const entry of searches.flat()) found.set(entry.id, [...(found.get(entry.id) ?? []), entry]);

    return found;
}

/** The best `limit` documents of the user's search and the rewordings', the assured ones first. */
export function mergeSearches(own: RankedEntry[], rewordings: RankedEntry[][], limit: number): RankedEntry[] {
    const searches = [own, ...rewordings];
    const found = groupById(searches);
    // A document only the meaning found is the one kind the words don't match.
    const wordMatches = new Set(searches.flat().flatMap((entry) => (entry.match === 'meaning' ? [] : [entry.id])));
    const fused = fuseWeighted(
        searches.map((entries) => ({ ids: entries.map((entry) => entry.id), weight: 1 })),
        wordMatches,
    );
    const assured = toAssuredIds(own, rewordings);
    const ordered = [...fused.filter((id) => assured.has(id)), ...fused.filter((id) => !assured.has(id))];

    return ordered.slice(0, limit).map((id) => {
        const entries = found.get(id)!;

        return { ...entries[0]!, match: combineMatches(entries.map((entry) => entry.match)) };
    });
}
