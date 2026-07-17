/**
 * Tag Sanitizer
 *
 * Turns LLM-proposed tags (plus topic/entity fallbacks) into a small set of
 * short, browse-friendly keywords. The model is instructed to propose good
 * tags, but this layer enforces the invariants regardless of what it returns:
 * short, low on digits, deduplicated (diacritic- and case-insensitive), capped.
 */

import type { Entity } from '@reverie/shared';

export const MAX_TAG_LENGTH = 30;
export const MAX_TAG_WORDS = 4;
export const MAX_TAGS_PER_DOCUMENT = 8;
export const MAX_DIGIT_RATIO = 0.3;

// Entity types allowed as fallback tag candidates (salient names only — never
// accounts, identifiers, locations, or contacts, which produce noisy tags).
const TAGGABLE_ENTITY_TYPES: ReadonlySet<Entity['type']> = new Set(['person', 'organization', 'product']);

/**
 * Deduplication key for a tag: lowercase, diacritics stripped, punctuation and
 * whitespace collapsed to single spaces. "Jaakonmäki" and "Jaakonmaki" collapse
 * to the same key.
 */
export function normalizeTagKey(tag: string): string {
    return tag
        .normalize('NFKD')
        .replace(/\p{M}/gu, '') // strip combining marks (diacritics)
        .toLowerCase()
        .replace(/[^\p{L}\p{Nd}]+/gu, ' ')
        .trim();
}

/**
 * Clean a single tag and reject it if it violates the browse-tag invariants.
 * Returns the cleaned tag, or null when it is empty, too long, too many words,
 * too digit-heavy, or has no letters at all.
 */
export function sanitizeTag(raw: string): string | null {
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    // Strip wrapping quotes/punctuation but keep internal hyphens, periods, etc.
    const tag = collapsed.replace(/^[^\p{L}\p{Nd}]+/u, '').replace(/[^\p{L}\p{Nd}]+$/u, '');

    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) {
        return null;
    }

    if (tag.split(' ').filter(Boolean).length > MAX_TAG_WORDS) {
        return null;
    }

    const letters = (tag.match(/\p{L}/gu) ?? []).length;

    if (letters === 0) {
        return null;
    }

    const digits = (tag.match(/\p{Nd}/gu) ?? []).length;

    if (digits / (letters + digits) > MAX_DIGIT_RATIO) {
        return null;
    }

    return tag;
}

export interface TagCandidates {
    /** The LLM's proposed `tags` array — priority 1. */
    proposedTags: string[];
    /** Fallback candidates used only when proposedTags yields nothing. */
    topics: string[];
    /** Fallback candidates (person/org/product canonical names) used last. */
    entities: Entity[];
    /** Tags already on the document (e.g. user tags) — deduplicated against. */
    existingTags: string[];
}

/**
 * Produce up to MAX_TAGS_PER_DOCUMENT sanitized tags, deduplicated within the
 * batch and against existingTags. Fallback candidates (topics, then salient
 * entity names) are consulted only when the proposed tags yield zero survivors.
 */
export function sanitizeTags(input: TagCandidates): string[] {
    const seen = new Set(input.existingTags.map(normalizeTagKey));
    const result: string[] = [];

    const consider = (candidates: string[]): void => {
        for (const candidate of candidates) {
            if (result.length >= MAX_TAGS_PER_DOCUMENT) {
                return;
            }

            const tag = sanitizeTag(candidate);

            if (!tag) {
                continue;
            }

            const key = normalizeTagKey(tag);

            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            result.push(tag);
        }
    };

    consider(input.proposedTags);

    if (result.length === 0) {
        consider(input.topics);
        consider(input.entities.filter((e) => TAGGABLE_ENTITY_TYPES.has(e.type)).map((e) => e.canonical_name));
    }

    return result;
}
