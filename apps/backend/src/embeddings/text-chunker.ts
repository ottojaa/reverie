/** Characters per chunk: bge-class models take 512 tokens, and Finnish runs about 3 characters per token. */
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 150;
/** A cap so a huge scanned book cannot queue thousands of vectors; the opening ~65k characters represent it. */
export const MAX_CHUNKS = 64;

export interface TextChunk {
    index: number;
    start: number;
    end: number;
    text: string;
}

/** Latest break at or before `limit` (paragraph, then line, then sentence, then space); `limit` itself if none is late enough. */
function findBreak(text: string, from: number, limit: number): number {
    if (limit >= text.length) return text.length;

    const window = text.slice(from, limit);
    const floor = Math.floor(window.length / 2);

    for (const separator of ['\n\n', '\n', '. ', ' ']) {
        const at = window.lastIndexOf(separator);

        if (at >= floor) return from + at + separator.length;
    }

    return limit;
}

/** Splits text into overlapping chunks at natural breaks. Offsets index into `text`; blank chunks are dropped. */
export function chunkText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    let start = 0;

    while (start < text.length && chunks.length < MAX_CHUNKS) {
        const end = findBreak(text, start, start + CHUNK_CHARS);
        const piece = text.slice(start, end);

        if (piece.trim()) chunks.push({ index: chunks.length, start, end, text: piece.trim() });

        if (end >= text.length) break;

        start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }

    return chunks;
}
