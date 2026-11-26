// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../../testing/render';
import { BrowseDashboard } from './BrowseDashboard';

// A subfolder of a closed lock: the tree does not list it, and its documents are refused.
const refused = { isAxiosError: true, response: { status: 403, data: { error: 'FOLDER_LOCKED', details: { folder_id: 'lock' } } } };
const idle = { data: undefined, error: null, isLoading: false, isError: false };

vi.mock('@/lib/sections', () => ({ useCurrentSection: () => null }));
vi.mock('@/lib/vault', () => ({ useVault: () => ({ requestUnlock: () => Promise.resolve(false) }) }));
vi.mock('@/lib/api', () => ({
    useInfiniteDocuments: () => ({ ...idle, error: refused }),
    useDocuments: () => idle,
    useDocumentSummary: () => idle,
}));
vi.mock('./BrowseFrame', () => ({
    BrowseFrame: ({ children }: { children?: unknown }) => children,
    LoadFailedBanner: () => null,
    SKELETON_DELAY_MS: 0,
}));
vi.mock('./BrowseHeader', async (importOriginal) => ({ ...(await importOriginal<typeof import('./BrowseHeader')>()), FolderActions: () => null }));
vi.mock('@/components/folders/LockedFolderNotice', () => ({ LockedFolderNotice: () => null }));

describe('BrowseDashboard of a folder under a closed lock', () => {
    it('says the folder is locked instead of passing for the whole library', () => {
        const view = mount(createElement(BrowseDashboard, { sectionId: 'under-lock' }));

        expect(document.querySelector('h1')?.textContent).toBe('Locked folder');
        view.unmount();
    });
});
