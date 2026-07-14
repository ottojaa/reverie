import { describe, expect, it } from 'vitest';
import { canvasLayoutKey, pruneStalePositions, type CanvasLayoutStore } from './canvasLayoutStorage.js';

describe('canvasLayoutStorage', () => {
    it('namespaces the storage key by user and schema version', () => {
        expect(canvasLayoutKey('u1')).toBe('reverie:canvas-layout:v1:u1');
    });

    it('prunes overrides for folders that no longer exist', () => {
        const store: CanvasLayoutStore = {
            version: 1,
            positions: { a: { x: 1, z: 2 }, gone: { x: 3, z: 4 } },
        };

        const pruned = pruneStalePositions(store, new Set(['a']));

        expect(pruned.positions).toEqual({ a: { x: 1, z: 2 } });
        expect(store.positions.gone).toBeDefined();
    });

    it('returns the same object when nothing is stale', () => {
        const store: CanvasLayoutStore = { version: 1, positions: { a: { x: 1, z: 2 } } };

        expect(pruneStalePositions(store, new Set(['a', 'b']))).toBe(store);
    });
});
