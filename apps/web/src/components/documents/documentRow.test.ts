// @vitest-environment jsdom
import { useDefaultSensors } from '@/lib/dnd';
import { SelectionProvider } from '@/lib/selection';
import { DndContext, type DragStartEvent } from '@dnd-kit/core';
import type { Document } from '@reverie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByText, mount, press, settle } from '../../testing/render';
import { BrowseFrame } from './BrowseFrame';
import { DocumentRow } from './DocumentRow';

const state = vi.hoisted(() => ({ isMobile: false, navigate: vi.fn(), deleted: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => state.navigate,
    Link: ({ to: _, params: __, preload: ___, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & Record<string, unknown>) =>
        createElement('a', { ...props, href: '#' }),
}));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => state.isMobile }));
vi.mock('@/lib/hooks/useConfirmedDelete', () => ({ useConfirmedDelete: () => state.deleted }));
vi.mock('@/lib/hooks/usePrefetchDocument', () => ({ usePrefetchDocument: () => () => {} }));
vi.mock('@/components/upload', () => ({ UploadFAB: () => null }));
vi.mock('./SelectionBanner', () => ({ SelectionBanner: () => null }));
vi.mock('./DocumentCard/RenameDialog', () => ({ RenameDialog: () => null }));
vi.mock('./DocumentCard/MoveToFolderDialog', () => ({
    MoveToFolderDialog: ({ documentIds }: { documentIds: string[] }) => createElement('output', null, documentIds.join(' ')),
}));

/** Longer than the row's long press and than the context menu's own. */
const HOLD_MS = 800;

const documents = ['doc-1', 'doc-2'].map(
    (id) => ({ id, original_filename: `${id}.txt`, mime_type: 'text/plain', size_bytes: 1, created_at: '2026-01-01T00:00:00Z' }) as Document,
);
const onDragStart = vi.fn<(event: DragStartEvent) => void>();

let view: ReturnType<typeof mount>;

/** The app's drag sensors around the rows. */
function Surface({ children }: { children?: ReactNode }) {
    return createElement(DndContext, { sensors: useDefaultSensors(), onDragStart }, children);
}

/** Two rows as the Files view holds them: selectable, and cleared by a click outside a document. */
function mountRows() {
    const rows = documents.map((document) =>
        createElement(DocumentRow, { key: document.id, document, orderedIds: ['doc-1', 'doc-2'], columns: '1fr', folderName: undefined, style: {} }),
    );
    const frame = createElement(BrowseFrame, { documents, children: rows });
    view = mount(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Surface, null, createElement(SelectionProvider, null, frame))),
    );
}

function rowAt(index: number) {
    return document.querySelectorAll<HTMLElement>('[data-document-card]')[index]!;
}

function linkAt(index: number) {
    return rowAt(index).querySelector('a')!;
}

function selected() {
    return documents.filter((_, index) => linkAt(index).className.includes('bg-primary/12')).map((document) => document.id);
}

function menu() {
    return document.querySelector('[role="menu"]');
}

async function fire(target: Element, event: Event) {
    await act(async () => void target.dispatchEvent(event));
}

function toTouchPointer(type: string) {
    return Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }), { pointerType: 'touch' });
}

async function touchDown(target: Element) {
    await fire(target, toTouchPointer('pointerdown'));
    await fire(target, new Event('touchstart', { bubbles: true, cancelable: true }));
}

async function touchUp(target: Element) {
    await fire(target, toTouchPointer('pointerup'));
    await fire(target, new Event('touchend', { bubbles: true, cancelable: true }));
}

/** A long press as a touch screen delivers it: no click follows the release. */
async function longPress(target: Element) {
    await touchDown(target);
    await settle(HOLD_MS);
    await touchUp(target);
}

async function tap(target: Element) {
    await touchDown(target);
    await touchUp(target);
    await act(async () => (target as HTMLElement).click());
    await settle();
}

function actionsButton(index: number) {
    return rowAt(index).querySelector<HTMLElement>('button[aria-label="Document actions"]');
}

async function pressKey(target: Element, key: 'Enter' | ' ', init: ConstructorParameters<typeof KeyboardEvent>[1] = {}) {
    const event = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...init });
    await fire(target, event);
    await settle();

    return event;
}

beforeEach(() => {
    state.isMobile = false;
    state.navigate.mockClear();
    state.deleted.mockClear();
    onDragStart.mockClear();
});

afterEach(() => view.unmount());

describe('a document row on a touch screen', () => {
    beforeEach(() => {
        state.isMobile = true;
        mountRows();
    });

    it('is selected by a long press, and no menu opens', async () => {
        await longPress(linkAt(0));

        expect(menu()).toBeNull();
        expect(selected()).toEqual(['doc-1']);
    });

    it('joins the selection on a long press, and leaves it on another', async () => {
        await longPress(linkAt(0));
        await longPress(linkAt(1));
        expect(selected()).toEqual(['doc-1', 'doc-2']);

        await longPress(linkAt(1));

        expect(selected()).toEqual(['doc-1']);
    });

    it('answers the tap that follows a long press', async () => {
        await longPress(linkAt(0));

        await tap(linkAt(0));

        expect(selected()).toEqual([]);
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it('opens its menu from a button, leaving the selection alone', async () => {
        await longPress(linkAt(0));

        await press(actionsButton(0));

        expect(menu()?.textContent).toBe('DownloadRenameMove to…Delete');
        expect(selected()).toEqual(['doc-1']);
    });

    it('does not open its menu when a finger only lands on the button, as one starting to scroll does', async () => {
        await fire(actionsButton(0)!, toTouchPointer('pointerdown'));

        expect(menu()).toBeNull();
    });

    it('is not selected by holding its menu button', async () => {
        await longPress(actionsButton(0)!);

        expect(selected()).toEqual([]);
    });

    it('moves the whole selection from that menu', async () => {
        await longPress(linkAt(0));
        await longPress(linkAt(1));
        await press(actionsButton(0));

        await press(findByText('[role="menuitem"]', 'Move to…'));

        expect(document.querySelector('output')?.textContent).toBe('doc-1 doc-2');
    });
});

describe('a document row with a mouse', () => {
    beforeEach(() => mountRows());

    it('has no menu button, and opens its menu on a right-click', async () => {
        expect(actionsButton(0)).toBeNull();

        await fire(linkAt(0), new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        expect(menu()?.textContent).toBe('DownloadRenameMove to…Delete');
    });

    it('moves the whole selection from the right-click menu', async () => {
        await act(async () => linkAt(0).click());
        await fire(linkAt(1), new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
        await fire(linkAt(0), new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        await press(findByText('[role="menuitem"]', 'Move to…'));

        expect(document.querySelector('output')?.textContent).toBe('doc-1 doc-2');
    });
});

describe('a focused document row', () => {
    beforeEach(() => mountRows());

    it('is one tab stop', () => {
        expect(rowAt(0).getAttribute('tabindex')).toBeNull();
        expect(rowAt(0).getAttribute('role')).toBeNull();
        expect(rowAt(0).querySelectorAll('a, button, [tabindex]')).toHaveLength(1);
    });

    it('opens on Enter', async () => {
        const event = await pressKey(linkAt(0), 'Enter');

        expect(state.navigate).toHaveBeenCalledWith({ to: '/document/$id', params: { id: 'doc-1' } });
        expect(event.defaultPrevented).toBe(true);
        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('toggles its selection on Space', async () => {
        const event = await pressKey(linkAt(0), ' ');
        await pressKey(linkAt(1), ' ');
        expect(selected()).toEqual(['doc-1', 'doc-2']);

        await pressKey(linkAt(1), ' ');

        expect(selected()).toEqual(['doc-1']);
        expect(event.defaultPrevented).toBe(true);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('shows its selection while it still has focus', async () => {
        await pressKey(linkAt(0), ' ');

        expect(linkAt(0).className).not.toContain('focus-visible:bg-muted');
    });

    it('acts once on a held key', async () => {
        await pressKey(linkAt(0), ' ');

        await pressKey(linkAt(0), ' ', { repeat: true });
        const heldEnter = await pressKey(linkAt(0), 'Enter', { repeat: true });

        expect(selected()).toEqual(['doc-1']);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(heldEnter.defaultPrevented).toBe(true);
    });

    it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }])('leaves a modified Enter to the browser: %o', async (modifier) => {
        const event = await pressKey(linkAt(0), 'Enter', modifier);

        expect(event.defaultPrevented).toBe(false);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(onDragStart).not.toHaveBeenCalled();
    });
});
