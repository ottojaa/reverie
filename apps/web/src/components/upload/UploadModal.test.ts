// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { findByText, mount, press, settle } from '../../testing/render';
import { UploadModal } from './UploadModal';

const state = vi.hoisted(() => ({ tree: [] as unknown[] }));
const files = [{ id: '1', file: new File(['x'], 'note.txt'), status: 'queued' }];

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ sectionId: 'photos' }) }));
vi.mock('@/lib/api/folders', () => ({
    foldersApi: { get: () => Promise.reject(Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 404 } })) },
}));
vi.mock('@/lib/sections', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/sections')>()),
    useSections: () => ({ data: state.tree }),
}));
vi.mock('@/lib/upload', () => ({
    isFileTooLarge: () => false,
    useUpload: () => ({ files, isModalOpen: true, stats: { queued: 1, uploading: 0, processing: 0, complete: 0, error: 0 } }),
}));
vi.mock('@/lib/hash/useFileHashes', () => ({ useFileHashes: () => ({}) }));
vi.mock('./useUploadCheck', () => ({ useUploadCheck: () => ({ review: null }) }));
vi.mock('./UploadFileItem', () => ({ UploadFileItem: () => null }));
vi.mock('./UploadDestinationMenu', () => ({
    UploadDestinationMenu: ({ folderId, onPick }: { folderId: string | null; onPick: (id: string) => void }) =>
        createElement('button', { onClick: () => onPick('trips') }, 'To: ' + folderId),
}));

describe('UploadModal destination', () => {
    it('goes back to the page folder when the picked one is trashed', async () => {
        const client = new QueryClient();
        const element = () => createElement(QueryClientProvider, { client }, createElement(UploadModal));

        state.tree = [toTestFolder('photos'), toTestFolder('trips')];
        const view = mount(element());

        await press(findByText('button', 'To: photos'));
        expect(findByText('button', 'To: trips')).toBeDefined();

        state.tree = [toTestFolder('photos')];
        view.render(element());
        await settle(10);

        expect(findByText('button', 'To: photos')).toBeDefined();
        view.unmount();
    });
});
