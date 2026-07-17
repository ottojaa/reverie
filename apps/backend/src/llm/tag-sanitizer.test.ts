import { describe, expect, it } from 'vitest';
import type { Entity } from '@reverie/shared';
import { normalizeTagKey, sanitizeTag, sanitizeTags } from './tag-sanitizer';

describe('sanitizeTag', () => {
    it('keeps a clean short tag', () => {
        expect(sanitizeTag('Nordea')).toBe('Nordea');
        expect(sanitizeTag('stock purchase')).toBe('stock purchase');
    });

    it('collapses whitespace and strips wrapping punctuation/quotes', () => {
        expect(sanitizeTag('  "securities   trading"  ')).toBe('securities trading');
        expect(sanitizeTag('(insurance)')).toBe('insurance');
    });

    it('drops tags over the length limit', () => {
        expect(sanitizeTag('Securities Account 022000 0000064299062')).toBeNull();
    });

    it('drops digit-heavy tags', () => {
        expect(sanitizeTag('Arvo-osuustili 022000 0000064299062')).toBeNull();
        expect(sanitizeTag('249818-385620')).toBeNull();
    });

    it('keeps tags with a low digit ratio', () => {
        expect(sanitizeTag('COVID-19')).toBe('COVID-19');
    });

    it('drops tags with too many words', () => {
        expect(sanitizeTag('securities transaction receipt confirmation form')).toBeNull();
    });

    it('drops empty and letterless tags', () => {
        expect(sanitizeTag('   ')).toBeNull();
        expect(sanitizeTag('123456')).toBeNull();
        expect(sanitizeTag('---')).toBeNull();
    });
});

describe('normalizeTagKey', () => {
    it('collapses diacritics and case to one key', () => {
        expect(normalizeTagKey('Jaakonmäki')).toBe(normalizeTagKey('Jaakonmaki'));
        expect(normalizeTagKey('Työsopimus')).toBe(normalizeTagKey('tyosopimus'));
    });
});

const entity = (type: Entity['type'], canonical_name: string): Entity => ({
    type,
    canonical_name,
    raw_text: canonical_name,
});

describe('sanitizeTags', () => {
    it('sanitizes, dedups, and caps proposed tags', () => {
        const tags = sanitizeTags({
            proposedTags: ['Nordea', 'nordea', 'Bank Account 249818-385620', 'stock purchase', 'Jaakonmäki', 'Jaakonmaki'],
            topics: [],
            entities: [],
            existingTags: [],
        });
        // 'nordea' deduped against 'Nordea'; account tag dropped; 'Jaakonmaki' deduped against 'Jaakonmäki'.
        expect(tags).toEqual(['Nordea', 'stock purchase', 'Jaakonmäki']);
    });

    it('caps at MAX_TAGS_PER_DOCUMENT prioritizing proposed tags', () => {
        const proposedTags = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
        expect(sanitizeTags({ proposedTags, topics: [], entities: [], existingTags: [] })).toHaveLength(8);
    });

    it('dedups case-insensitively against existing tags', () => {
        const tags = sanitizeTags({
            proposedTags: ['Nordea', 'stock purchase'],
            topics: [],
            entities: [],
            existingTags: ['NORDEA'],
        });
        expect(tags).toEqual(['stock purchase']);
    });

    it('falls back to topics then salient entities only when proposed tags yield nothing', () => {
        const tags = sanitizeTags({
            proposedTags: ['0000064299062', 'Account 249818-385620 reference'],
            topics: ['securities trading'],
            entities: [entity('organization', 'Nordea'), entity('account', 'Bank Account 249818-385620')],
            existingTags: [],
        });
        // proposed all invalid → fallback: topic + org name (account entity excluded).
        expect(tags).toEqual(['securities trading', 'Nordea']);
    });

    it('does not use fallbacks when proposed tags survive', () => {
        const tags = sanitizeTags({
            proposedTags: ['Nordea'],
            topics: ['securities trading'],
            entities: [entity('organization', 'Danske')],
            existingTags: [],
        });
        expect(tags).toEqual(['Nordea']);
    });

    it('returns empty for no usable candidates', () => {
        expect(sanitizeTags({ proposedTags: [], topics: [], entities: [], existingTags: [] })).toEqual([]);
    });
});
