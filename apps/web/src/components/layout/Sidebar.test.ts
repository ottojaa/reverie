// @vitest-environment jsdom
import { createElement, createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../../testing/render';
import { Sidebar } from './Sidebar';

const route = vi.hoisted(() => ({ pathname: '/browse', sectionId: undefined as string | undefined }));

vi.mock('@tanstack/react-router', () => ({
    useLocation: () => ({ pathname: route.pathname }),
    useParams: () => ({ sectionId: route.sectionId }),
    Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => createElement('a', { href: to, className }, children),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/api/users', () => ({ useUser: () => ({ data: undefined }) }));
vi.mock('@/lib/sections', () => ({ useSections: () => ({ data: [], isLoading: false }) }));
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/folderTree/FolderTree', () => ({ FolderTree: () => null }));
vi.mock('@/components/sections', () => ({ CreateSectionModal: () => null }));
vi.mock('./SidebarFooter', () => ({ SidebarFooter: () => null }));

/** The labels of the sidebar links drawn as the current page (the logo link has no highlight). */
function highlightedAt(pathname: string, sectionId?: string): string[] {
    Object.assign(route, { pathname, sectionId });
    const view = mount(createElement(Sidebar, { treeDragHandlersRef: createRef() }));
    const labels = Array.from(document.querySelectorAll('aside a'))
        .filter((link) => link.classList.contains('text-sidebar-primary'))
        .map((link) => link.textContent ?? '');
    view.unmount();

    return labels;
}

describe('Sidebar highlight', () => {
    it('marks All Documents on the library page', () => {
        expect(highlightedAt('/browse')).toEqual(['All Documents']);
    });

    it.each([
        ['/trash', 'Trash'],
        ['/duplicates', 'Duplicates'],
        ['/canvas', 'Canvas'],
    ])('marks only its own entry on %s', (pathname, label) => {
        expect(highlightedAt(pathname)).toEqual([label]);
    });

    it.each(['/settings', '/search'])('does not mark All Documents on %s', (pathname) => {
        expect(highlightedAt(pathname)).toEqual([]);
    });

    it('does not mark All Documents inside a folder', () => {
        expect(highlightedAt('/browse/photos', 'photos')).toEqual([]);
    });
});
