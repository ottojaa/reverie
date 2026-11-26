// @vitest-environment jsdom
import { documentsApi } from '@/lib/api/documents';
import { UploadProvider, useUpload } from '@/lib/upload/UploadContext';
import { uploadFile } from '@/lib/upload/uploadApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByText, mount, press, settle } from '../../testing/render';
import { UploadModal } from './UploadModal';

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({}) }));
vi.mock('@/lib/sections', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/sections')>()),
    useSections: () => ({ data: [] }),
}));
vi.mock('@/lib/socket', () => ({
    ensureSocketConnected: () => Promise.resolve(),
    onJobEvents: () => () => {},
    subscribeToDocument: () => {},
    subscribeToSession: () => {},
    unsubscribeFromDocument: () => {},
    unsubscribeFromSession: () => {},
}));
vi.mock('@/lib/upload/uploadApi', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/api/documents', () => ({ documentsApi: { checkContent: vi.fn() } }));
vi.mock('@/lib/hash/useFileHashes', () => ({
    useFileHashes: (files: { id: string }[]) => Object.fromEntries(files.map((f) => [f.id, { status: 'done', sha256: 'abc' }])),
}));
vi.mock('./UploadDestinationMenu', () => ({ UploadDestinationMenu: () => null }));

const upload = vi.mocked(uploadFile);
const checkContent = vi.mocked(documentsApi.checkContent);
const stored = { session_id: 's', documents: [{ id: 'doc-1' }], jobs: [] } as unknown as Awaited<ReturnType<typeof uploadFile>>;

function AddFile() {
    const { addFiles } = useUpload();

    useEffect(() => {
        addFiles([new File(['x'], 'note.txt', { type: 'text/plain' })]);
    }, [addFiles]);

    return null;
}

/** The modal with one file whose first upload has just failed. */
async function mountFailedUpload() {
    const view = mount(
        createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(UploadProvider, null, createElement(AddFile), createElement(UploadModal)),
        ),
    );

    await settle();
    upload.mockRejectedValueOnce(new Error('Disk is full'));
    await press(findByText('button', 'Upload 1 file'));
    await settle(10);
    expect(document.body.textContent).toContain('Disk is full');

    return view;
}

beforeEach(() => {
    upload.mockReset();
    checkContent.mockReset();
    checkContent.mockResolvedValue([{ content: null, name_conflict: false }] as never);
});

let view: ReturnType<typeof mount>;

afterEach(() => view.unmount());

describe('Retry all', () => {
    it('uploads the failed files again', async () => {
        view = await mountFailedUpload();
        upload.mockResolvedValueOnce(stored);

        await press(findByText('button', 'Retry all'));
        await settle(10);

        expect(upload).toHaveBeenCalledTimes(2);
        expect(document.body.textContent).not.toContain('Disk is full');
        expect(findByText('button', 'Retry all')).toBeUndefined();
    });

    it('shows the new reason when a file fails again', async () => {
        view = await mountFailedUpload();
        upload.mockRejectedValueOnce(new Error('Connection lost'));

        await press(findByText('button', 'Retry all'));
        await settle(10);

        expect(upload).toHaveBeenCalledTimes(2);
        expect(document.body.textContent).toContain('Connection lost');
        expect(findByText('button', 'Retry all')).toBeDefined();
    });

    it('asks first when the folder has since got a file of that name, then uploads as answered', async () => {
        view = await mountFailedUpload();
        checkContent.mockResolvedValue([{ content: null, name_conflict: true }] as never);
        upload.mockResolvedValueOnce(stored);

        await press(findByText('button', 'Retry all'));
        await settle(10);

        expect(upload).toHaveBeenCalledTimes(1);
        await press(findByText('button', 'Upload 1 file'));
        await settle(10);

        expect(upload).toHaveBeenCalledTimes(2);
        expect(upload.mock.calls[1]?.[1].conflictStrategy).toBeDefined();
    });
});
