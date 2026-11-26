// @vitest-environment jsdom
import { documentsApi } from '@/lib/api/documents';
import { UploadProvider, useUpload } from '@/lib/upload/UploadContext';
import { uploadFile } from '@/lib/upload/uploadApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
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
// The file rows play no part in the overall count, and their success animation does not run in jsdom.
vi.mock('./UploadFileItem', () => ({ UploadFileItem: () => null }));

type Uploaded = Awaited<ReturnType<typeof uploadFile>>;

const MB = 1_000_000;
const upload = vi.mocked(uploadFile);
const checkContent = vi.mocked(documentsApi.checkContent);
const stored = { session_id: 's', documents: [{ id: 'doc-1' }], jobs: [] } as unknown as Uploaded;

/** Uploads in flight, by file name: report their progress and finish them by hand. */
const inFlight = new Map<string, { progress: (loaded: number) => Promise<void>; fail: () => Promise<void> }>();

let addFiles: (files: File[]) => void;
let view: ReturnType<typeof mount>;

function ReadUpload() {
    addFiles = useUpload().addFiles;

    return null;
}

function toFile(name: string, size: number) {
    return new File([new Uint8Array(size)], name);
}

async function add(...files: File[]) {
    await act(async () => addFiles(files));
    await settle();
}

async function pressButton(text: string) {
    await press(findByText('button', text));
    await settle(10);
}

function byName(name: string) {
    const found = inFlight.get(name);

    if (!found) throw new Error('No upload in flight: ' + name);

    return found;
}

beforeEach(() => {
    inFlight.clear();
    upload.mockReset();
    upload.mockImplementation(
        (file, options) =>
            new Promise((_, reject) => {
                inFlight.set(file.name, {
                    progress: (loaded) => act(async () => options.onProgress?.(loaded, file.size)),
                    fail: () => act(async () => reject(new Error('Disk is full'))),
                });
            }),
    );
    checkContent.mockImplementation((_, files) => Promise.resolve(files.map(() => ({ content: null, name_conflict: false })) as never));
    view = mount(
        createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(UploadProvider, null, createElement(ReadUpload), createElement(UploadModal)),
        ),
    );
});

afterEach(() => view.unmount());

describe('upload progress', () => {
    it('counts only the second batch, not the files already uploaded', async () => {
        upload.mockResolvedValueOnce(stored);
        await add(toFile('first.bin', 3 * MB));
        await pressButton('Upload 1 file');

        await add(toFile('second.bin', MB));
        await pressButton('Upload 1 file');
        await byName('second.bin').progress(MB / 2);

        expect(document.body.textContent).toContain('Uploading 500.0 KB of 1.0 MB');
    });

    it('counts only the files being retried', async () => {
        upload.mockResolvedValueOnce(stored);
        upload.mockRejectedValueOnce(new Error('Disk is full'));
        await add(toFile('first.bin', 3 * MB), toFile('second.bin', MB));
        await pressButton('Upload 2 files');

        await pressButton('Retry all');
        await byName('second.bin').progress(MB / 2);

        expect(document.body.textContent).toContain('Uploading 500.0 KB of 1.0 MB');
    });

    it('drops a file that fails from both sides of the count', async () => {
        await add(toFile('first.bin', 3 * MB), toFile('second.bin', MB));
        await pressButton('Upload 2 files');
        await byName('first.bin').progress(2 * MB);
        await byName('second.bin').progress(MB / 2);
        expect(document.body.textContent).toContain('Uploading 2.5 MB of 4.0 MB');

        await byName('first.bin').fail();

        expect(document.body.textContent).toContain('Uploading 500.0 KB of 1.0 MB');
    });

    it('stops showing bytes as soon as every file has failed', async () => {
        await add(toFile('first.bin', 3 * MB), toFile('second.bin', MB));
        await pressButton('Upload 2 files');

        await byName('first.bin').fail();
        await byName('second.bin').fail();

        expect(document.body.textContent).toContain('2 failed');
        expect(document.body.textContent).not.toMatch(/Uploading [\d.]+ \S+ of/);
    });
});
