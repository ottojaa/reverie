// @vitest-environment jsdom
import type { DragOverlay, Modifier } from '@dnd-kit/core';
import { createElement, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../testing/render';
import { DragPreview } from './DragPreview';
import type { TreeDrag } from './useTreeDrag';

const overlay = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@dnd-kit/core')>()),
    DragOverlay: (props: Record<string, unknown>) => {
        overlay.props = props;

        return null;
    },
}));

const WINDOW = { top: 0, left: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
/** A row of the Files table on a 1280px window, and the size of the "1 document" label. */
const ROW = { top: 281, left: 280, right: 1256, bottom: 333, width: 976, height: 52 };
const LABEL = { width: 112, height: 38 };

let view: ReturnType<typeof mount> | undefined;

afterEach(() => view?.unmount());

/** Where the overlay is drawn: at the dragged element's corner, in the size dnd-kit gives it, moved by the modifiers. */
function drawOverlay(drag: TreeDrag, start: { x: number; y: number }, pointer: { x: number; y: number }) {
    view = mount(createElement(DragPreview, { drag, tree: [] }));
    const { modifiers = [], style } = overlay.props as ComponentProps<typeof DragOverlay>;
    // The overlay takes the row's size unless its style says otherwise, and then it is as big as its content.
    const size = style?.width === undefined ? ROW : LABEL;
    const rect = { ...ROW, width: size.width, height: size.height, right: ROW.left + size.width, bottom: ROW.top + size.height };
    const transform = (modifiers as Modifier[]).reduce(
        (current, modify) =>
            modify({
                activatorEvent: new MouseEvent('mousedown', { clientX: start.x, clientY: start.y }),
                active: null,
                activeNodeRect: ROW,
                containerNodeRect: null,
                draggingNodeRect: rect,
                over: null,
                overlayNodeRect: rect,
                scrollableAncestors: [],
                scrollableAncestorRects: [],
                transform: current,
                windowRect: WINDOW,
            }),
        { x: pointer.x - start.x, y: pointer.y - start.y, scaleX: 1, scaleY: 1 },
    );
    const left = rect.left + transform.x;
    const top = rect.top + transform.y;

    return { left, top, right: left + rect.width, bottom: top + rect.height };
}

describe('the preview of dragged documents', () => {
    const documents: [string, TreeDrag][] = [
        ['one document', { type: 'documents', documentIds: ['a'] }],
        ['several documents', { type: 'documents', documentIds: ['a', 'b', 'c'] }],
    ];
    const pointers = [
        ['over the sidebar', { x: 60, y: 300 }],
        ['in the middle', { x: 640, y: 400 }],
        ['at the right edge', { x: 1270, y: 300 }],
        ['at the bottom right corner', { x: 1278, y: 798 }],
        ['at the top left corner', { x: 2, y: 2 }],
    ] as const;

    describe.each(documents)('for %s', (_, drag) => {
        it.each(pointers)('is on screen beside the pointer %s', (__, pointer) => {
            const box = drawOverlay(drag, { x: 600, y: 300 }, pointer);

            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.top).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(WINDOW.right);
            expect(box.bottom).toBeLessThanOrEqual(WINDOW.bottom);
            // Clear of the pointer on one side, and no further off than a small gap.
            const gap = Math.max(box.left - pointer.x, pointer.x - box.right);
            expect(gap).toBeGreaterThan(0);
            expect(gap).toBeLessThanOrEqual(16);
            expect(box.top).toBeLessThanOrEqual(Math.max(pointer.y, 0));
            expect(box.bottom).toBeGreaterThanOrEqual(Math.min(pointer.y, WINDOW.bottom));
        });
    });
});
