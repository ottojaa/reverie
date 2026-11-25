import { DocumentListResponseSchema, FolderTreeResponseSchema, SearchResponseSchema } from '@reverie/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Responses captured from the server's routes, so what the web parses is what the server sends. */
function loadFixture(name: string): unknown {
    return JSON.parse(readFileSync(new URL(`../../../../../libs/shared/src/fixtures/${name}.json`, import.meta.url), 'utf8'));
}

describe('server contract fixtures', () => {
    it('parses a folder tree nested three levels deep', () => {
        const [photos] = FolderTreeResponseSchema.parse(loadFixture('folder-tree'));

        expect(photos?.children.find((folder) => folder.name === 'Trips')?.children.map((folder) => folder.name)).toEqual(['Norway']);
    });

    it('parses a folder-scoped search', () => {
        const { results } = SearchResponseSchema.parse(loadFixture('folder-search'));

        expect(results).toHaveLength(2);
    });

    it('parses a page of top-level documents', () => {
        const { items } = DocumentListResponseSchema.parse(loadFixture('top-level-documents'));

        expect(items.length).toBeGreaterThan(0);
        expect(items.every((document) => document.folder_id === null)).toBe(true);
    });
});
