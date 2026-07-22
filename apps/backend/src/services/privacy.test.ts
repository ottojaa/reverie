import { describe, expect, it } from 'vitest';
import { isDocumentEffectivelyPrivate } from './privacy';

describe('isDocumentEffectivelyPrivate', () => {
    const privateFolderIds = ['folder-a', 'folder-b'];

    it('is private when the document owns the flag', () => {
        expect(isDocumentEffectivelyPrivate({ is_private: true, folder_id: null }, [])).toBe(true);
        expect(isDocumentEffectivelyPrivate({ is_private: true, folder_id: 'public-folder' }, privateFolderIds)).toBe(true);
    });

    it('is private when it lives in an effectively-private folder', () => {
        expect(isDocumentEffectivelyPrivate({ is_private: false, folder_id: 'folder-a' }, privateFolderIds)).toBe(true);
    });

    it('is not private with own flag off and no/public folder', () => {
        expect(isDocumentEffectivelyPrivate({ is_private: false, folder_id: null }, privateFolderIds)).toBe(false);
        expect(isDocumentEffectivelyPrivate({ is_private: false, folder_id: 'public-folder' }, privateFolderIds)).toBe(false);
    });

    it('treats an empty private-folder set as no folder-inherited privacy', () => {
        expect(isDocumentEffectivelyPrivate({ is_private: false, folder_id: 'folder-a' }, [])).toBe(false);
    });
});
