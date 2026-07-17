import { describe, expect, it } from 'vitest';
import type { Entity } from '@reverie/shared';
import { buildSpellingCorrector, correctText, correctWord } from './spelling-corrector';

const OCR = 'NORDEA SECURITIES OYJ\nTIETOENATOR SUOMI 180 shares\nAleksanterinkatu 30 00100 HELSINKI';

const entity = (type: Entity['type'], canonical_name: string, raw_text = canonical_name): Entity => ({
    type,
    canonical_name,
    raw_text,
});

const ENTITIES: Entity[] = [
    entity('organization', 'Nordea Securities Oyj', 'NORDEA SECURITIES OYJ'),
    entity('product', 'TIETOENATOR SUOMI', 'TIETOENATOR SUOMI'),
    entity('location', 'Aleksanterinkatu 30, 00100 Helsinki', 'Aleksanterinkatu 30 00100 HELSINKI'),
];

const corrector = buildSpellingCorrector(ENTITIES, OCR);

describe('buildSpellingCorrector', () => {
    it('keeps only in-document, long-enough, letter-bearing words as trusted', () => {
        expect(corrector.trusted).toContain('tietoenator');
        expect(corrector.trusted).toContain('securities');
        expect(corrector.trusted).toContain('aleksanterinkatu');
        // too short (<6)
        expect(corrector.trusted).not.toContain('suomi');
        expect(corrector.trusted).not.toContain('oyj');
        // numeric token, not a proper noun
        expect(corrector.trusted).not.toContain('00100');
    });

    it('ignores entity words that do not appear in the OCR text', () => {
        const c = buildSpellingCorrector([entity('organization', 'Fabricated Holdings')], OCR);
        expect(c.trusted).toEqual([]);
    });
});

describe('correctWord', () => {
    it('pulls a hallucinated letter-insertion back to the document spelling', () => {
        expect(correctWord('Tietonenator', corrector)).toBe('Tietoenator'); // inserted "n"
    });

    it('preserves the original case pattern', () => {
        expect(correctWord('TIETONENATOR', corrector)).toBe('TIETOENATOR'); // all caps
        expect(correctWord('tietonenator', corrector)).toBe('tietoenator'); // lower
        expect(correctWord('Tietonenator', corrector)).toBe('Tietoenator'); // titlecase
    });

    it('leaves real document words untouched', () => {
        expect(correctWord('Nordea', corrector)).toBe('Nordea');
        expect(correctWord('Securities', corrector)).toBe('Securities');
        expect(correctWord('Aleksanterinkatu', corrector)).toBe('Aleksanterinkatu');
    });

    it('does not touch short words', () => {
        expect(correctWord('Suomi', corrector)).toBe('Suomi');
        expect(correctWord('shares', corrector)).toBe('shares');
    });

    it('does not correct words that are not close to any trusted proper noun', () => {
        expect(correctWord('confirmation', corrector)).toBe('confirmation');
        expect(correctWord('purchased', corrector)).toBe('purchased');
    });

    it('does not correct across a differing prefix or a large edit distance', () => {
        expect(correctWord('Securitisation', corrector)).toBe('Securitisation'); // shares prefix but far
        expect(correctWord('Enterprise', corrector)).toBe('Enterprise');
    });
});

describe('correctText', () => {
    it('fixes a hallucinated name inside a summary, preserving surrounding text', () => {
        const summary = 'This confirms the purchase of 180 shares of Tietonenator Suomi from Nordea Securities.';
        expect(correctText(summary, corrector)).toBe('This confirms the purchase of 180 shares of Tietoenator Suomi from Nordea Securities.');
    });

    it('fixes a hallucinated name inside a tag', () => {
        expect(correctText('Tietonenator Suomi', corrector)).toBe('Tietoenator Suomi');
    });

    it('returns text unchanged when there are no trusted words', () => {
        const empty = buildSpellingCorrector([], OCR);
        expect(correctText('Tietonenator Suomi', empty)).toBe('Tietonenator Suomi');
    });
});
