// @vitest-environment jsdom
import { createElement, act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOOTER_OPEN_KEY, SidebarFooter } from './SidebarFooter';

// The router and the animation layer are not under test here: plain anchors and plain divs keep the DOM synchronous.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, className, onClick }: { to: string; children: unknown; className?: string; onClick?: () => void }) =>
        createElement(
            'a',
            {
                href: to,
                className,
                onClick: (event: { preventDefault: () => void }) => {
                    event.preventDefault();
                    onClick?.();
                },
            },
            children as never,
        ),
}));

vi.mock('motion/react', () => {
    const passthrough = ({ children, id, className }: { children?: unknown; id?: string; className?: string }) =>
        createElement('div', { id, className }, children as never);

    return {
        AnimatePresence: ({ children }: { children?: unknown }) => children,
        motion: { div: passthrough, span: passthrough },
        useReducedMotion: () => false,
    };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GB = 1024 ** 3;
const member = { role: 'user' as const, storage_used_bytes: 2 * GB, storage_quota_bytes: 10 * GB };
const admin = { ...member, role: 'admin' as const };

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<ComponentProps<typeof SidebarFooter>> = {}) {
    act(() => {
        root.render(createElement(SidebarFooter, { user: member, pathname: '/browse', ...props }));
    });
}

const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
const linkLabels = () => [...container.querySelectorAll('a')].map((a) => a.textContent?.trim()).filter((label) => !label?.includes('used'));

beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('SidebarFooter', () => {
    it('starts collapsed: storage row and toggle only, no links in the tab order', () => {
        render();

        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(container.textContent).toContain('2.15 GB of 10.74 GB used');
        expect(linkLabels()).toEqual([]);
    });

    it('expands and collapses, keeping aria-expanded, aria-controls and the label in step', () => {
        render();
        act(() => toggle().click());

        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(toggle().getAttribute('aria-label')).toBe('Hide settings and admin links');
        expect(document.getElementById(toggle().getAttribute('aria-controls')!)).not.toBeNull();

        act(() => toggle().click());

        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(toggle().getAttribute('aria-label')).toBe('Show settings and admin links');
    });

    it('shows only Settings to a member', () => {
        render();
        act(() => toggle().click());

        expect(linkLabels()).toEqual(['Settings']);
    });

    it('shows Settings, Agent, Users and Server settings to an admin', () => {
        render({ user: admin });
        act(() => toggle().click());

        expect(linkLabels()).toEqual(['Settings', 'Agent', 'Users', 'Server settings']);
    });

    it('remembers the choice across a remount', () => {
        render();
        act(() => toggle().click());

        expect(localStorage.getItem(FOOTER_OPEN_KEY)).toBe('1');

        act(() => root.unmount());
        root = createRoot(container);
        render();

        expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    it('stays collapsed and still toggles when storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        render();

        expect(toggle().getAttribute('aria-expanded')).toBe('false');

        act(() => toggle().click());

        expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    it('calls onClose when a link is followed', () => {
        const onClose = vi.fn();

        render({ onClose });
        act(() => toggle().click());
        act(() => container.querySelector<HTMLAnchorElement>('a[href="/settings"]')!.click());

        expect(onClose).toHaveBeenCalled();
    });
});
