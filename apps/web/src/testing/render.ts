import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks these, and Radix and cmdk call them.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub;

Element.prototype.scrollIntoView ??= () => {};

Element.prototype.hasPointerCapture ??= () => false;

/** Mounts a component into the page for a test. Dialogs and popovers render into `document.body`, so query there. */
export function mount(element: ReactNode) {
    const container = document.createElement('div');

    document.body.append(container);

    const root = createRoot(container);
    const render = (next: ReactNode) => act(() => root.render(next));

    render(element);

    return {
        render,
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

/** Lets pending promises, timers of zero and the renders they cause finish. */
export function settle(ms = 0) {
    return act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** A pointer press and click, which opens Radix menus, selects and popovers alike. */
export async function press(element: Element | null | undefined) {
    if (!element) throw new Error('Nothing to press');

    await act(async () => {
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        (element as HTMLElement).click();
    });
    await settle();
}

export async function keyDown(element: Element | null | undefined, key: string) {
    if (!element) throw new Error('Nothing to type into');

    await act(async () => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    await settle();
}

export async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** The first element matching the selector whose text includes `text`. */
export function findByText(selector: string, text: string): HTMLElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLElement>(selector)).find((element) => element.textContent?.includes(text));
}
