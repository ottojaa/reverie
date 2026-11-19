/**
 * Proper-noun scoring for the model-comparison harness.
 *
 * A noun is `exact` when it appears verbatim (Finnish inflections count: the
 * check is a substring match), `near` when the closest stretch of text is within
 * a couple of edits or differs only by diacritics/case, and `absent` otherwise.
 */

export type NounOutcome = 'exact' | 'near' | 'absent';

/** Lowercase and strip diacritics so "Jyväskylä" and "Jyvaskyla" compare equal. */
export function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Smallest edit distance between `needle` and any substring of `haystack`
 * (Sellers' approximate substring match: a free start in the haystack).
 */
export function minSubstringDistance(needle: string, haystack: string): number {
    let previous = Array.from({ length: haystack.length + 1 }, () => 0);

    for (let row = 1; row <= needle.length; row++) {
        const current = [row];

        for (let col = 1; col <= haystack.length; col++) {
            const cost = needle[row - 1] === haystack[col - 1] ? 0 : 1;

            current.push(Math.min((previous[col - 1] ?? 0) + cost, (previous[col] ?? 0) + 1, (current[col - 1] ?? 0) + 1));
        }

        previous = current;
    }

    return Math.min(...previous);
}

/** Short names tolerate one edit, longer ones two: a looser bound matches unrelated words. */
function maxEdits(noun: string): number {
    return noun.length >= 8 ? 2 : 1;
}

export function scoreProperNoun(noun: string, texts: string[]): NounOutcome {
    if (texts.some((text) => text.includes(noun))) return 'exact';

    const foldedNoun = foldText(noun);
    const isNear = texts.some((text) => minSubstringDistance(foldedNoun, foldText(text)) <= maxEdits(foldedNoun));

    return isNear ? 'near' : 'absent';
}

export interface OutcomeCounts {
    exact: number;
    near: number;
    absent: number;
}

export function countOutcomes(outcomes: NounOutcome[]): OutcomeCounts {
    return {
        exact: outcomes.filter((outcome) => outcome === 'exact').length,
        near: outcomes.filter((outcome) => outcome === 'near').length,
        absent: outcomes.filter((outcome) => outcome === 'absent').length,
    };
}

/** "No worse" than the baseline: at least as many exact nouns and no more absent ones. */
export function isNoWorse(candidate: OutcomeCounts, baseline: OutcomeCounts): boolean {
    return candidate.exact >= baseline.exact && candidate.absent <= baseline.absent;
}
