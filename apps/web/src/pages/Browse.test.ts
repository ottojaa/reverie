// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../testing/folders';
import { mount, settle } from '../testing/render';
import { BrowsePage } from './Browse';

const navigate = vi.fn();
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/api/folders', () => ({ foldersApi: { ...api, getTree: () => Promise.resolve([toTestFolder('photos')]) } }));
vi.mock('@/lib/vault', () => ({ useVault: () => ({ requestUnlock: () => Promise.resolve(true) }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@/components/documents/BrowseDashboard', () => ({ BrowseDashboard: () => null }));
vi.mock('@/components/documents/BrowseKindView', () => ({ BrowseKindView: () => null }));

const toApiError = (status: number) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data: {} } });

async function openFolder(sectionId: string) {
    const view = mount(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(BrowsePage, { sectionId })));

    await settle(10);
    view.unmount();
}

beforeEach(() => vi.clearAllMocks());

describe('BrowsePage', () => {
    it('leaves a folder that is gone for the top of the library', async () => {
        api.get.mockRejectedValue(toApiError(404));
        await openFolder('binned');

        expect(navigate).toHaveBeenCalledWith({ to: '/browse', replace: true });
    });

    it('stays on a folder the tree leaves out because its lock is closed', async () => {
        api.get.mockRejectedValue(toApiError(403));
        await openFolder('hidden');

        expect(api.get).toHaveBeenCalledWith('hidden');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('asks nothing about a folder the tree lists', async () => {
        await openFolder('photos');

        expect(api.get).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});
