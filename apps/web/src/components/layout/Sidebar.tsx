import { FolderTree } from '@/components/folderTree/FolderTree';
import { CreateSectionModal } from '@/components/sections';
import { Button } from '@/components/ui/button';
import { useUser } from '@/lib/api/users';
import { useAuth } from '@/lib/auth';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import { Copy, LayoutGrid, Map, Plus, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RefObject } from 'react';
import { useRef, useState } from 'react';
import { Separator } from '../ui/separator';
import { Skeleton } from '../ui/skeleton';
import type { TreeDragHandlers } from './Layout';
import { SidebarFooter } from './SidebarFooter';

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
    treeDragHandlersRef: RefObject<TreeDragHandlers | null>;
}

export function Sidebar({ isOpen = false, onClose, treeDragHandlersRef }: SidebarProps) {
    const params = useParams({ strict: false });
    const location = useLocation();
    const currentSectionId = (params as { sectionId?: string }).sectionId;
    const { user: authUser } = useAuth();
    const { data: userFromQuery } = useUser();
    const { data: sections = [], isLoading } = useSections();

    const user = userFromQuery ?? authUser;

    // Where the create dialog puts the new folder; undefined while it is closed, null for the top level.
    const [newFolderParent, setNewFolderParent] = useState<string | null>();

    const navRef = useRef<HTMLElement>(null);

    const isMobile = useIsMobile();

    const navContent = (
        <>
            {/* Logo */}
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
                <Link to="/browse" className="flex min-w-0 items-center gap-2" onClick={onClose}>
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="text-sm font-bold">R</span>
                    </div>
                    <span className="text-lg font-semibold tracking-tight">Reverie</span>
                </Link>
                {onClose && (
                    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 md:hidden" onClick={onClose} aria-label="Close menu">
                        <X className="size-5" />
                    </Button>
                )}
            </div>

            {/* Sections */}
            <nav
                ref={navRef}
                className="relative flex min-h-0 flex-1 touch-pan-y flex-col gap-3 overflow-y-auto p-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
                <div className="flex flex-col gap-1.5">
                    <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Library</p>
                    <Link
                        to="/browse"
                        onClick={onClose}
                        className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                            !currentSectionId
                                ? 'bg-sidebar-accent text-sidebar-primary shadow-sm'
                                : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground',
                        )}
                    >
                        <LayoutGrid className={cn('size-4 shrink-0', !currentSectionId ? 'text-sidebar-primary' : 'text-muted-foreground')} aria-hidden />
                        <span>All Documents</span>
                    </Link>
                    <Link
                        to="/canvas"
                        preload="intent"
                        onClick={onClose}
                        className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                            location.pathname.startsWith('/canvas')
                                ? 'bg-sidebar-accent text-sidebar-primary shadow-sm'
                                : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground',
                        )}
                    >
                        <Map
                            className={cn('size-4 shrink-0', location.pathname.startsWith('/canvas') ? 'text-sidebar-primary' : 'text-muted-foreground')}
                            aria-hidden
                        />
                        <span>Canvas</span>
                    </Link>
                    <Link
                        to="/duplicates"
                        onClick={onClose}
                        className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                            location.pathname.startsWith('/duplicates')
                                ? 'bg-sidebar-accent text-sidebar-primary shadow-sm'
                                : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground',
                        )}
                    >
                        <Copy
                            className={cn('size-4 shrink-0', location.pathname.startsWith('/duplicates') ? 'text-sidebar-primary' : 'text-muted-foreground')}
                            aria-hidden
                        />
                        <span>Duplicates</span>
                    </Link>
                    <Link
                        to="/trash"
                        onClick={onClose}
                        className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                            location.pathname.startsWith('/trash')
                                ? 'bg-sidebar-accent text-sidebar-primary shadow-sm'
                                : 'text-sidebar-foreground/90 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground',
                        )}
                    >
                        <Trash2
                            className={cn('size-4 shrink-0', location.pathname.startsWith('/trash') ? 'text-sidebar-primary' : 'text-muted-foreground')}
                            aria-hidden
                        />
                        <span>Trash</span>
                    </Link>
                </div>

                <Separator className="bg-sidebar-border" />

                {isLoading ? (
                    <>
                        <div className="space-y-0.5">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ paddingLeft: 8 + (i % 2) * 20 }}>
                                    <Skeleton className="size-4 shrink-0 rounded" />
                                    <Skeleton className="size-4 shrink-0 rounded" />
                                    <Skeleton className="h-4 flex-1 max-w-[120px]" />
                                </div>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            className="w-full justify-start gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
                            onClick={() => setNewFolderParent(null)}
                        >
                            <Plus className="size-4" />
                            New folder
                        </Button>
                    </>
                ) : (
                    <FolderTree
                        tree={sections}
                        currentId={currentSectionId}
                        dragHandlersRef={treeDragHandlersRef}
                        onNewFolder={setNewFolderParent}
                        onClose={onClose}
                    />
                )}
            </nav>

            <SidebarFooter user={user} pathname={location.pathname} onClose={onClose} />

            <CreateSectionModal
                open={newFolderParent !== undefined}
                onOpenChange={(open) => !open && setNewFolderParent(undefined)}
                parentId={newFolderParent ?? null}
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
                    'flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar',
                    'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out md:relative md:transform-none',
                    isMobile ? 'w-80' : 'w-64',
                    !isOpen && '-translate-x-full md:translate-x-0',
                )}
            >
                {navContent}
            </aside>
        </>
    );
}
