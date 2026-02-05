import { CreateSectionModal } from '@/components/sections';
import { useConfirm } from '@/lib/confirm';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useDeleteFolder, useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { Link, useParams } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { SortableTree } from '../sortableTree/SortableTree';

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
    const params = useParams({ strict: false });
    const currentSectionId = (params as { sectionId?: string }).sectionId;
    const { data: sections = [], isLoading } = useSections();
    const confirm = useConfirm();
    const deleteFolder = useDeleteFolder();

    const { openEdit } = useSectionEdit();
    const [createModalParent, setCreateModalParent] = useState<string | null | undefined>(undefined);
    const navRef = useRef<HTMLElement>(null);
    const [dropIndicatorLocalY, setDropIndicatorLocalY] = useState<number>(0);
    const [showDropIndicator, setShowDropIndicator] = useState(false);
    /** Viewport Y reported by SectionTree from measured DOM boundaries (stable per gap) */
    const [dropIndicatorViewportY, setDropIndicatorViewportY] = useState<number | null>(null);

    useLayoutEffect(() => {
        if (dropIndicatorViewportY == null || !navRef.current) {
            setShowDropIndicator(false);
            return;
        }
        const sync = () => {
            const nav = navRef.current;
            if (!nav) return;
            const r = nav.getBoundingClientRect();
            const localY = dropIndicatorViewportY - r.top + nav.scrollTop;
            setDropIndicatorLocalY(localY);
            setShowDropIndicator(true);
        };
        sync();
        const nav = navRef.current;
        nav.addEventListener('scroll', sync);
        return () => nav.removeEventListener('scroll', sync);
    }, [dropIndicatorViewportY]);

    const handleAddSubSection = (parentId: string | null) => {
        setCreateModalParent(parentId);
    };

    const handleEditSection = (section: FolderWithChildren) => {
        openEdit(section);
    };

    const handleDeleteSection = async (section: FolderWithChildren) => {
        const ok = await confirm({
            title: 'Delete section?',
            description: `"${section.name}" and its sub-sections will be deleted. Documents inside will remain but will no longer be in a section.`,
            confirmText: 'Delete',
            variant: 'destructive',
        });
        if (ok) deleteFolder.mutate(section.id);
    };

    const navContent = (
        <>
            {/* Logo */}
            <div className="flex h-14 items-center border-b border-sidebar-border px-4">
                <Link to="/browse" className="flex items-center gap-2" onClick={onClose}>
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="text-sm font-bold">R</span>
                    </div>
                    <span className="text-lg font-semibold tracking-tight">Reverie</span>
                </Link>
            </div>

            {/* Sections */}
            <nav ref={navRef} className="relative flex-1 space-y-0.5 overflow-y-auto p-3">
                <Link
                    to="/browse"
                    onClick={onClose}
                    className={cn(
                        'mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                        !currentSectionId
                            ? 'bg-sidebar-accent text-sidebar-primary'
                            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                >
                    All Documents
                </Link>
                <div
                    className="absolute left-3 right-3 z-10 h-0.5 rounded-full bg-primary transition-opacity duration-75"
                    style={{
                        top: dropIndicatorLocalY,
                        opacity: showDropIndicator ? 1 : 0,
                        pointerEvents: 'none',
                    }}
                />
                {isLoading ? (
                    <div className="py-2 text-sm text-muted-foreground">Loading sections…</div>
                ) : sections.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">No sections yet</div>
                ) : (
                    <SortableTree />
                )}
                <button
                    type="button"
                    className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={() => setCreateModalParent(null)}
                >
                    <span className="text-base">+</span>
                    New section
                </button>
            </nav>

            {/* Settings */}
            <div className="border-t border-sidebar-border p-3">
                <Link
                    to="/settings"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={onClose}
                >
                    <Settings className="size-4" />
                    Settings
                </Link>
            </div>

            <CreateSectionModal
                open={createModalParent !== undefined}
                onOpenChange={(open) => !open && setCreateModalParent(undefined)}
                parentId={createModalParent ?? null}
            />
        </>
    );

    return (
        <>
            {/* Mobile backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.button
                        type="button"
                        aria-label="Close menu"
                        className="fixed inset-0 z-40 bg-black/50 md:hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar: drawer on mobile, static on desktop */}
            <aside
                className={cn(
                    'flex w-64 flex-col border-r border-sidebar-border bg-sidebar',
                    'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out md:relative md:transform-none',
                    !isOpen && '-translate-x-full md:translate-x-0',
                )}
            >
                {navContent}
            </aside>
        </>
    );
}
