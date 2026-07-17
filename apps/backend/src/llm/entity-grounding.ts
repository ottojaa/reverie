/**
 * Entity Grounding
 *
 * Guards entity canonical names against LLM hallucination while still allowing
 * legitimate OCR-error corrections.
 *
 * The distinction: real OCR errors are *visual character confusions* (0↔O,
 * 1↔l/I, 5↔S, rn↔m, spacing) — the letter skeleton is preserved. Hallucinations
 * change the skeleton (inserting/removing/substituting letters outside those
 * classes), e.g. "TIETOENATOR" → "Tietoennator". We accept corrections that stay
 * within the confusion classes and fall back to the document's own spelling for
 * anything else. raw_text is always retained regardless.
 */

import type { Entity } from '@reverie/shared';
import type { LlmEntity } from './llm-response.schema';

/**
 * Casing/whitespace/diacritic-insensitive normalization. Non-alphanumeric runs
 * become single spaces; the result is trimmed.
 */
export function normalizeForGrounding(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/\p{M}/gu, '') // strip combining marks (diacritics)
        .toLowerCase()
        .replace(/[^\p{L}\p{Nd}]+/gu, ' ')
        .trim();
}

// Digraph confusions, applied before single-character mapping.
const CONFUSION_DIGRAPHS: ReadonlyArray<readonly [RegExp, string]> = [
    [/rn/g, 'm'],
    [/vv/g, 'w'],
];

// Each character maps to a representative of its OCR-confusion class.
const CONFUSION_CLASSES: Readonly<Record<string, string>> = {
    '0': 'o',
    o: 'o',
    '1': 'i',
    l: 'i',
    i: 'i',
    '5': 's',
    s: 's',
    '8': 'b',
    b: 'b',
    '2': 'z',
    z: 'z',
    '6': 'g',
    g: 'g',
    c: 'e',
    e: 'e',
};

/**
 * Collapse a string to its OCR-confusion canonical form: diacritics/case/
 * punctuation removed (via normalizeForGrounding), whitespace stripped (spacing
 * errors), then confusion digraphs and single characters mapped to one
 * representative per class. Two strings with the same letter skeleton up to
 * common OCR confusions produce the same result.
 */
export function confusionNormalize(text: string): string {
    let s = normalizeForGrounding(text).replace(/\s+/gu, '');

    for (const [pattern, replacement] of CONFUSION_DIGRAPHS) {
        s = s.replace(pattern, replacement);
    }

    return [...s].map((ch) => CONFUSION_CLASSES[ch] ?? ch).join('');
}

/** True if `candidate` is grounded in the document under the acceptance rules. */
export function isGrounded(candidate: string, rawText: string, normalizedHaystack: string): boolean {
    const normalizedCandidate = normalizeForGrounding(candidate);

    if (normalizedCandidate.length === 0) {
        return false;
    }

    // 1. Casing/whitespace/diacritics-only difference from the model's own raw_text.
    if (normalizedCandidate === normalizeForGrounding(rawText)) {
        return true;
    }

    // 2. Spelled that way verbatim somewhere in the document.
    if (normalizedHaystack.includes(normalizedCandidate)) {
        return true;
    }

    // 3. Every difference from raw_text is a visual OCR confusion or spacing fix.
    return confusionNormalize(candidate) === confusionNormalize(rawText);
}

/**
 * Ground each entity's canonical_name against the full OCR text. Accepted names
 * are kept; ungrounded (likely hallucinated) names fall back to the cleaned
 * raw_text. The haystack is normalized once for the whole batch.
 */
export function groundEntities(entities: LlmEntity[], ocrRawText: string): Entity[] {
    const normalizedHaystack = normalizeForGrounding(ocrRawText);

    return entities.map((entity) => {
        if (isGrounded(entity.canonical_name, entity.raw_text, normalizedHaystack)) {
            return { type: entity.type, canonical_name: entity.canonical_name, raw_text: entity.raw_text };
        }

        const cleaned = entity.raw_text.replace(/\s+/gu, ' ').trim();

        return {
            type: entity.type,
            canonical_name: cleaned.length > 0 ? cleaned : entity.canonical_name,
            raw_text: entity.raw_text,
        };
    });
}
