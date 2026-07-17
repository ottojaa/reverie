import { describe, expect, it } from 'vitest';
import type { LlmEntity } from './llm-response.schema';
import { confusionNormalize, groundEntities, normalizeForGrounding } from './entity-grounding';

const OCR = 'NORDEA SECURITIES OYJ\nTIETOENATOR SUOMI 180 shares\nAleksanterinkatu30 00100 HELSINKI\nR0BERT Hels1nki';

const entity = (canonical_name: string, raw_text: string, type: LlmEntity['type'] = 'organization'): LlmEntity => ({
    type,
    canonical_name,
    raw_text,
});

function ground(canonical: string, raw: string): string {
    return groundEntities([entity(canonical, raw)], OCR)[0]!.canonical_name;
}

describe('normalizeForGrounding', () => {
    it('strips diacritics, case, and punctuation', () => {
        expect(normalizeForGrounding('Jaakonmäki, Otto')).toBe('jaakonmaki otto');
    });
});

describe('confusionNormalize', () => {
    it('collapses common OCR confusions to one form', () => {
        expect(confusionNormalize('Nordca')).toBe(confusionNormalize('Nordea')); // c↔e
        expect(confusionNormalize('Hels1nki')).toBe(confusionNormalize('Helsinki')); // 1↔i
        expect(confusionNormalize('R0BERT')).toBe(confusionNormalize('ROBERT')); // 0↔O
    });

    it('does not collapse letter insertions', () => {
        expect(confusionNormalize('Tietoennator')).not.toBe(confusionNormalize('Tietoenator'));
    });
});

describe('groundEntities', () => {
    it('grounds a verbatim copy', () => {
        expect(ground('Nordea Securities Oyj', 'Nordea Securities Oyj')).toBe('Nordea Securities Oyj');
    });

    it('grounds a casing/whitespace-only change', () => {
        expect(ground('Tietoenator Suomi', 'TIETOENATOR SUOMI')).toBe('Tietoenator Suomi');
    });

    it('grounds a name found verbatim elsewhere in the OCR text', () => {
        // raw_text differs, but the canonical appears in the document.
        expect(ground('Nordea Securities Oyj', 'Nordea')).toBe('Nordea Securities Oyj');
    });

    it('accepts legitimate OCR-confusion corrections', () => {
        expect(ground('Nordea', 'Nordca')).toBe('Nordea'); // c↔e
        expect(ground('Helsinki', 'Hels1nki')).toBe('Helsinki'); // 1↔i
        expect(ground('ROBERT', 'R0BERT')).toBe('ROBERT'); // 0↔O
        expect(ground('Aleksanterinkatu 30', 'Aleksanterinkatu30')).toBe('Aleksanterinkatu 30'); // spacing
    });

    it('rejects a letter insertion (hallucination) and falls back to raw_text', () => {
        expect(ground('Tietoennator Suomi', 'TIETOENATOR SUOMI')).toBe('TIETOENATOR SUOMI');
    });

    it('rejects a diacritic hallucination', () => {
        expect(ground('Tietoänator Suomi', 'TIETOENATOR SUOMI')).toBe('TIETOENATOR SUOMI');
    });

    it('rejects a confusion fix combined with an extra letter', () => {
        // c↔e is legit, but the trailing extra 'a' changes the skeleton.
        expect(ground('Nordeaa', 'Nordca')).toBe('Nordca');
    });

    it('cleans whitespace in the fallback raw_text', () => {
        expect(ground('Hallucinated Name', 'Some   Raw\nText')).toBe('Some Raw Text');
    });
});
