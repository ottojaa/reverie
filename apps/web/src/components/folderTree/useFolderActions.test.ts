// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTestFolder } from '../../testing/folders';
import { mount, settle } from '../../testing/render';
import { useFolderActions } from './useFolderActions';

const navigate = vi.fn();
const api = vi.hoisted(() => ({ delete: vi.fn(), get: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/api/folders', () => ({ foldersApi: api }));
vi.mock('@/lib/confirm', () => ({ useConfirm: () => () => Promise.resolve(true) }));
vi.mock('@/lib/SectionEditContext', () => ({ useSectionEdit: () => ({ openEdit: () => {} }) }));
vi.mock('@/lib/vault', () => ({ useVault: () => ({ hasPassword: true, requestUnlock: () => Promise.resolve(true) }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

const toApiError = (status: number) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data: {} } });

/** Deletes the folder from the row menu while the page shows `currentId`. */
async function deleteWhileOn(currentId: string | undefined, folder = toTestFolder('trips', { parent_id: 'photos' })) {
    let actions!: ReturnType<typeof useFolderActions>;

    function Probe() {
        actions = useFolderActions(currentId, () => {});

        return null;
    }

    const view = mount(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)));

    actions.onDelete(folder);
    await settle(10);
    view.unmount();
}

beforeEach(() => {
    vi.clearAllMocks();
    api.delete.mockResolvedValue(undefined);
    api.get.mockRejectedValue(toApiError(404));
});

describe('trashing from the sidebar', () => {
    it('leaves the trashed folder for the one above it', async () => {
        await deleteWhileOn('trips');

        expect(navigate).toHaveBeenCalledWith({ to: '/browse/$sectionId', params: { sectionId: 'photos' }, replace: true });
    });

    it('leaves a folder inside the trashed one too', async () => {
        await deleteWhileOn('norway');

        expect(api.get).toHaveBeenCalledWith('norway');
        expect(navigate).toHaveBeenCalledWith({ to: '/browse/$sectionId', params: { sectionId: 'photos' }, replace: true });
    });

    it('goes to the top of the library when a top-level folder goes', async () => {
        await deleteWhileOn('trips', toTestFolder('trips'));

        expect(navigate).toHaveBeenCalledWith({ to: '/browse', replace: true });
    });

    it.each([
        ['is still there', () => api.get.mockResolvedValue({})],
        ['is only hidden behind a closed lock', () => api.get.mockRejectedValue(toApiError(403))],
    ])('stays on a folder that %s', async (_label, arrange) => {
        arrange();
        await deleteWhileOn('receipts');

        expect(api.delete).toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('stays put outside the folders, and when the delete fails', async () => {
        await deleteWhileOn(undefined);
        api.delete.mockRejectedValue(toApiError(500));
        await deleteWhileOn('trips');

        expect(navigate).not.toHaveBeenCalled();
    });
});
