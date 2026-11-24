import { beforeEach, describe, expect, it } from 'vitest';
import { expandedGroups, resetExpandedGroups, toggleExpandedGroup } from './expanded-groups';

describe('expanded groups', () => {
    beforeEach(resetExpandedGroups);

    it('opens and shuts a group', () => {
        toggleExpandedGroup('library', 'a');
        expect(expandedGroups('library').has('a')).toBe(true);

        toggleExpandedGroup('library', 'a');
        expect(expandedGroups('library').has('a')).toBe(false);
    });

    it('keeps each scope to itself', () => {
        toggleExpandedGroup('library', 'a');

        expect(expandedGroups('folder-1').has('a')).toBe(false);
    });

    it('hands out a new set on a change, so a store snapshot compares unequal', () => {
        const before = expandedGroups('library');
        toggleExpandedGroup('library', 'a');

        expect(expandedGroups('library')).not.toBe(before);
        expect(expandedGroups('library')).toBe(expandedGroups('library'));
    });
});
