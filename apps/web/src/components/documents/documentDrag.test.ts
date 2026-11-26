// @vitest-environment jsdom
import { useDefaultSensors } from '@/lib/dnd';
import { DndContext, type DragStartEvent } from '@dnd-kit/core';
import type { Document } from '@reverie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type MouseEventHandler, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../testing/render';
import { DocumentCard } from './DocumentCard/DocumentCard';
import { DocumentRow } from './DocumentRow';
import { DocumentTile } from './DocumentTile';

const state = vi.hoisted(() => ({ isMobile: false, selectOnly: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => () => {},
    Link: ({ children, onClick }: { children?: ReactNode; onClick?: MouseEventHandler }) => createElement('a', { href: '#', onClick }, children),
}));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => state.isMobile }));
vi.mock('@/lib/hooks/useConfirmedDelete', () => ({ useConfirmedDelete: () => () => {} }));
vi.mock('@/lib/hooks/usePrefetchDocument', () => ({ usePrefetchDocument: () => () => {} }));
vi.mock('@/lib/selection', () => ({
    useSelectionOptional: () => ({ isSelected: () => false, selectedIds: new Set(), selectOnly: state.selectOnly }),
}));
vi.mock('./DocumentCard/DocumentActionsMenu', () => ({ DocumentActionsMenu: ({ children }: { children?: ReactNode }) => children }));
vi.mock('./DocumentCard/DocumentCardVisual', () => ({ DocumentCardVisual: () => null }));
vi.mock('./DocumentCard/DocumentThumbnail', () => ({ DocumentThumbnail: () => null }));

const doc = { id: 'doc-1', original_filename: 'note.txt', mime_type: 'text/plain', size_bytes: 1, created_at: '2026-01-01T00:00:00Z' } as Document;
const onDragStart = vi.fn<(event: DragStartEvent) => void>();

function Surface({ children }: { children?: ReactNode }) {
    return createElement(DndContext, { sensors: useDefaultSensors(), onDragStart }, children);
}

const items: [string, ReactNode][] = [
    ['row', createElement(DocumentRow, { document: doc, orderedIds: [], columns: '1fr', folderName: undefined, style: {} })],
    ['card', createElement(DocumentCard, { document: doc })],
    ['tile', createElement(DocumentTile, { document: doc, orderedIds: [], width: 100, height: 100 })],
];

let view: ReturnType<typeof mount>;

async function fire(target: Element | Document, event: Event) {
    await act(async () => void target.dispatchEvent(event));
}

function toMouse(type: string, clientX = 0) {
    return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
}

/** Mounts the document inside the app's drag sensors and returns the link a pointer lands on. */
function mountItem(item: ReactNode) {
    view = mount(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Surface, null, item)));

    return document.querySelector('[data-document-card] a')!;
}

beforeEach(() => {
    state.isMobile = false;
    state.selectOnly.mockClear();
    onDragStart.mockClear();
});

afterEach(async () => {
    await fire(document, toMouse('mouseup'));
    await settle(60);
    view.unmount();
});

describe.each(items)('a single document %s', (_name, item) => {
    it('starts a drag of itself when pressed and moved', async () => {
        const link = mountItem(item);

        await fire(link, toMouse('mousedown'));
        await fire(document, toMouse('mousemove', 20));

        expect(onDragStart).toHaveBeenCalledTimes(1);
        expect(onDragStart.mock.calls[0]?.[0].active.data.current).toEqual({ type: 'documents', documentIds: ['doc-1'] });
    });

    it('is selected by a slow click that does not move', async () => {
        const link = mountItem(item);

        await fire(link, toMouse('mousedown'));
        await settle(500);
        await fire(link, toMouse('mouseup'));
        await fire(link, toMouse('click'));

        expect(state.selectOnly).toHaveBeenCalledWith('doc-1');
        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('is selected, not dragged, by a long press on a touch screen', async () => {
        state.isMobile = true;
        const link = mountItem(item);

        await fire(link, new TouchEvent('touchstart', { bubbles: true, touches: [{ clientX: 0, clientY: 0 } as Touch] }));
        await settle(500);

        expect(state.selectOnly).toHaveBeenCalledWith('doc-1');
        expect(onDragStart).not.toHaveBeenCalled();
    });
});
