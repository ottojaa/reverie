import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, MAX_CHUNKS, chunkText } from './text-chunker';

describe('chunkText', () => {
    it('returns nothing for blank text', () => {
        expect(chunkText('')).toEqual([]);
        expect(chunkText('  \n\n ')).toEqual([]);
    });

    it('keeps short text as one chunk', () => {
        expect(chunkText('Sähkölasku maaliskuu')).toEqual([{ index: 0, start: 0, end: 20, text: 'Sähkölasku maaliskuu' }]);
    });

    it('splits long text at paragraph breaks and overlaps neighbours', () => {
        const paragraph = 'Lorem ipsum dolor sit amet. '.repeat(20).trim();
        const chunks = chunkText([paragraph, paragraph, paragraph].join('\n\n'));

        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((chunk, i) => {
            expect(chunk.index).toBe(i);
            expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHARS);
        });
        expect(chunks[1]!.start).toBeLessThan(chunks[0]!.end);
    });

    it('covers the whole text when under the cap', () => {
        const text = 'sana '.repeat(1000);
        const chunks = chunkText(text);

        expect(chunks.at(-1)!.end).toBe(text.length);
    });

    it('stops at the chunk cap', () => {
        expect(chunkText('x'.repeat(CHUNK_CHARS * (MAX_CHUNKS + 20)))).toHaveLength(MAX_CHUNKS);
    });

    it('splits text with no break points by length', () => {
        const chunks = chunkText('x'.repeat(CHUNK_CHARS * 2));

        expect(chunks[0]!.end).toBe(CHUNK_CHARS);
    });
});
