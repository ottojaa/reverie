/**
 * Spelling Corrector
 *
 * Entity grounding (entity-grounding.ts) protects the structured entity
 * canonical_names, but the model also writes the same proper nouns into
 * free-text fields — the summary, title, topics, and tags — and those paths are
 * not grounded. The model sometimes grounds an entity correctly yet re-types the
 * same name with an extra/dropped letter in prose (e.g. the document says
 * "TIETOENATOR" and the entity is correct, but the summary says "Tietonenator").
 *
 * This module scrubs those free-text fields against the *grounded* entities,
 * which carry the document's true spellings. It only ever rewrites a word toward
 * a proper noun that actually appears in the OCR text, and only when the word is
 * a close (small edit-distance) variant that is not itself present in the
 * document — so legitimate, abstractive words ("stock purchase") are untouched.
 *
 * Unlike entity grounding, this uses edit distance rather than confusion
 * classes: a hallucinated respelling ("Tietonenator") is a letter insertion, not
 * a visual confusion, so the skeleton-preserving confusion check cannot catch it.
 */

import type { Entity } from '@reverie/shared';
import { normalizeForGrounding } from './entity-grounding';

// Words shorter than this are never corrected — short words are cheap to reach
// by edit distance and the risk of a false rewrite outweighs the benefit.
export const MIN_CORRECTABLE_LENGTH = 6;

export interface SpellingCorrector {
    /** Normalized proper-noun words (from grounded entities) known to appear in the document. */
    trusted: string[];
    /** All normalized word tokens present in the OCR text — a word here is real, never rewritten. */
    ocrTokens: ReadonlySet<string>;
}

function tokenize(text: string): string[] {
    return normalizeForGrounding(text)
        .split(' ')
        .filter((word) => word.length > 0);
}

/**
 * Build a corrector from the grounded entities and the OCR text. Trusted words
 * are the letter-bearing words of the grounded entity names that are also
 * present verbatim in the OCR text — i.e. real document spellings we can pull
 * hallucinated variants back toward.
 */
export function buildSpellingCorrector(entities: Entity[], ocrRawText: string): SpellingCorrector {
    const ocrTokens = new Set(tokenize(ocrRawText));
    const trusted = new Set<string>();

    for (const entity of entities) {
        for (const source of [entity.canonical_name, entity.raw_text]) {
            for (const word of tokenize(source)) {
                if (word.length >= MIN_CORRECTABLE_LENGTH && /\p{L}/u.test(word) && ocrTokens.has(word)) {
                    trusted.add(word);
                }
            }
        }
    }

    return { trusted: [...trusted], ocrTokens };
}

/** Levenshtein distance, short-circuiting once every cell in a row exceeds `cap`. */
function boundedLevenshtein(a: string, b: string, cap: number): number {
    if (Math.abs(a.length - b.length) > cap) {
        return cap + 1;
    }

    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);

    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        let rowMin = i;

        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
            curr.push(value);
            rowMin = Math.min(rowMin, value);
        }

        if (rowMin > cap) {
            return cap + 1;
        }

        prev = curr;
    }

    return prev[b.length]!;
}

/** Apply the case pattern of `template` (ALL CAPS / Titlecase / lowercase) to `letters`. */
function matchCase(letters: string, template: string): string {
    if (template === template.toUpperCase()) {
        return letters.toUpperCase();
    }

    if (template[0] === template[0]!.toUpperCase()) {
        return letters.charAt(0).toUpperCase() + letters.slice(1);
    }

    return letters;
}

/**
 * Correct a single word against the corrector. Returns the word unchanged unless
 * it is a close, unambiguous variant of exactly one trusted proper noun and is
 * not itself a real document token.
 */
export function correctWord(word: string, corrector: SpellingCorrector): string {
    const norm = normalizeForGrounding(word);

    if (norm.length < MIN_CORRECTABLE_LENGTH || corrector.ocrTokens.has(norm)) {
        return word;
    }

    let best: string | null = null;
    let bestDistance = Infinity;
    let ambiguous = false;

    for (const candidate of corrector.trusted) {
        if (candidate === norm) {
            return word; // identical spelling after normalization — nothing to fix
        }

        // Cheap prefix gate: a shared 2-char prefix keeps unrelated words apart.
        if (candidate[0] !== norm[0] || candidate[1] !== norm[1]) {
            continue;
        }

        const allowed = Math.max(candidate.length, norm.length) >= 10 ? 2 : 1;
        const distance = boundedLevenshtein(norm, candidate, allowed);

        if (distance < 1 || distance > allowed) {
            continue;
        }

        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
            ambiguous = false;
        } else if (distance === bestDistance) {
            ambiguous = true;
        }
    }

    if (!best || ambiguous) {
        return word;
    }

    return matchCase(best, word);
}

/**
 * Correct proper-noun spellings in a free-text field against the corrector.
 * Only letter runs are considered; punctuation, digits, and spacing are
 * preserved exactly.
 */
export function correctText(text: string, corrector: SpellingCorrector): string {
    if (corrector.trusted.length === 0) {
        return text;
    }

    return text.replace(/\p{L}+/gu, (word) => correctWord(word, corrector));
}
