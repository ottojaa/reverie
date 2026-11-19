import { describe, expect, it } from 'vitest';
import { countOutcomes, foldText, isNoWorse, minSubstringDistance, scoreProperNoun } from './scoring';

describe('scoreProperNoun', () => {
    it('counts a verbatim match, including a Finnish inflection, as exact', () => {
        expect(scoreProperNoun('Jyväskylä', ['Vuokrasopimus Jyväskylässä'])).toBe('exact');
    });

    it('counts a diacritic-only difference as near', () => {
        expect(scoreProperNoun('Äänekoski', ['Aanekoski power bill'])).toBe('near');
    });

    it('counts a one-letter respelling of a long name as near', () => {
        expect(scoreProperNoun('Tietoenator', ['Tietonenator invoice'])).toBe('near');
    });

    it('counts an unrelated text as absent', () => {
        expect(scoreProperNoun('Jyväskylä', ['Helsinki invoice'])).toBe('absent');
    });

    it('allows only one edit for a short name', () => {
        expect(scoreProperNoun('Espoo', ['Esboo'])).toBe('near');
        expect(scoreProperNoun('Espoo', ['Estvv'])).toBe('absent');
    });
});

describe('minSubstringDistance and foldText', () => {
    it('finds the closest substring', () => {
        expect(minSubstringDistance('cat', 'a cart')).toBe(1);
    });

    it('folds case and diacritics', () => {
        expect(foldText('ÄÖÅ Ä')).toBe('aoa a');
    });
});

describe('isNoWorse', () => {
    const baseline = countOutcomes(['exact', 'exact', 'near', 'absent']);

    it('accepts equal or better counts', () => {
        expect(isNoWorse(countOutcomes(['exact', 'exact', 'exact', 'near']), baseline)).toBe(true);
        expect(isNoWorse(baseline, baseline)).toBe(true);
    });

    it('rejects fewer exact matches or more absent ones', () => {
        expect(isNoWorse(countOutcomes(['exact', 'near', 'near', 'absent']), baseline)).toBe(false);
        expect(isNoWorse(countOutcomes(['exact', 'exact', 'absent', 'absent']), baseline)).toBe(false);
    });
});
