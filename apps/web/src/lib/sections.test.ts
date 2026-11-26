// @vitest-environment jsdom
import type { UpdateFolderRequest } from '@reverie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../testing/render';
import { useDeleteFolder, useUpdateFolder } from './sections';

vi.mock('./api/folders', () => ({ foldersApi: { patch: () => Promise.resolve({}), delete: () => Promise.resolve() } }));
vi.mock('./vault', () => ({ useVault: () => ({ requestUnlock: () => Promise.resolve(true) }) }));
vi.mock('./auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

/** Runs one call of a mutation hook and returns the first key of every query it marked stale. */
async function toInvalidated<T>(useHook: () => T, call: (hook: T) => Promise<unknown>): Promise<string[]> {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let hook!: T;

    function Probe() {
        hook = useHook();

        return null;
    }

    const view = mount(createElement(QueryClientProvider, { client }, createElement(Probe)));

    await act(() => call(hook));
    view.unmount();

    return invalidate.mock.calls.map(([filters]) => String(filters?.queryKey?.[0])).sort();
}

const afterUpdate = (data: UpdateFolderRequest) => toInvalidated(useUpdateFolder, (hook) => hook.mutateAsync({ id: 'a', data }));

describe('useUpdateFolder', () => {
    it.each<[string, UpdateFolderRequest]>([
        ['a move into a folder', { parent_id: 'b' }],
        ['a move to the top level', { parent_id: null }],
        ['making it private', { is_private: true }],
        ['making it public', { is_private: false }],
    ])('refreshes document and search lists after %s', async (_label, data) => {
        expect(await afterUpdate(data)).toEqual(['documents', 'search', 'sections']);
    });

    it('refreshes search hits after a rename', async () => {
        expect(await afterUpdate({ name: 'New name' })).toEqual(['search', 'sections']);
    });

    it('leaves the lists alone when only the icon changes', async () => {
        expect(await afterUpdate({ emoji: 'star' })).toEqual(['sections']);
    });
});

describe('useDeleteFolder', () => {
    it('refreshes search too, so no hit leads back into the trashed folder', async () => {
        expect(await toInvalidated(useDeleteFolder, (hook) => hook.mutateAsync('a'))).toEqual(['documents', 'search', 'sections', 'trash']);
    });
});
