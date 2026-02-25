import { CategorizedSections } from '@/components/categorizedSections';
import { CreateSectionModal, type FolderMode } from '@/components/sections';
import { Button } from '@/components/ui/button';
import { useUser } from '@/lib/api/users';
import { useAuth } from '@/lib/auth';
import { formatFileSize } from '@/lib/commonhelpers';
import { useConfirm } from '@/lib/confirm';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useDeleteFolder, useReorderSections, useSections, useUpdateFolder } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import { Settings, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '../ui/skeleton';
import type { SortableTreeHandlers } from './Layout';

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
    sortableTreeHandlersRef?: RefObject<SortableTreeHandlers | null>;
}

export function Sidebar({ isOpen = false, onClose, sortableTreeHandlersRef }: SidebarProps) {
    const params = useParams({ strict: false });
    const location = useLocation();
    const currentSectionId = (params as { sectionId?: string }).sectionId;
    const { user: authUser } = useAuth();
    const { data: userFromQuery } = useUser();
    const { data: sections = [], isLoading } = useSections();
    const confirm = useConfirm();

    const user = userFromQuery ?? authUser;
    const storagePct = user && user.storage_quota_bytes > 0 ? (user.storage_used_bytes / user.storage_quota_bytes) * 100 : 0;
    const deleteFolder = useDeleteFolder();
    const reorderSections = useReorderSections();
    const updateFolder = useUpdateFolder();

    const { openEdit } = useSectionEdit();

    // Create modal state
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createModalMode, setCreateModalMode] = useState<FolderMode>('folder');
    const [createModalParent, setCreateModalParent] = useState<string | null>(null);

    const navRef = useRef<HTMLElement>(null);

    const isMobile = useIsMobile();

    const openCreateCollection = () => {
        setCreateModalMode('collection');
        setCreateModalParent(null);
        setCreateModalOpen(true);
    };

    const openCreateFolder = (collectionId: string) => {
        setCreateModalMode('folder');
        setCreateModalParent(collectionId);
        setCreateModalOpen(true);
    };

    useEffect(() => {
        const handler = () => openCreateCollection();

        window.addEventListener('reverie:openCreateCollection', handler);

        return () => window.removeEventListener('reverie:openCreateCollection', handler);
    }, []);

    const handleEditSection = (section: FolderWithChildren) => {
        openEdit(section);
    };

    const handleEditCategory = (category: FolderWithChildren) => {
        openEdit(category);
    };

    const handleDeleteSection = async (section: FolderWithChildren) => {
        const ok = await confirm({
            title: 'Delete folder?',
            description: `"${section.name}" will be deleted. Documents inside will remain but will no longer be in a folder.`,
            confirmText: 'Delete',
            variant: 'destructive',
        });

        if (ok) deleteFolder.mutate(section.id);
    };

    const handleDeleteCategory = async (category: FolderWithChildren) => {
        const sectionCount = category.children.length;

        if (sectionCount === 0) {
            deleteFolder.mutate(category.id);

            return;
        }

        const ok = await confirm({
            title: 'Delete collection?',
            description: `"${category.name}" and its ${sectionCount} folder${sectionCount !== 1 ? 's' : ''} will be deleted. Documents inside folders will remain but will no longer be in a folder.`,
            confirmText: 'Delete',
            variant: 'destructive',
        });

        if (ok) deleteFolder.mutate(category.id);
    };

    const handleSectionsChange = async (orderUpdates: Array<{ id: string; sort_order: number }>, parentChanges?: Array<{ id: string; parent_id: string }>) => {
        // Persist parent changes first so backend has correct parent_id before reorder
        if (parentChanges?.length) {
            await Promise.all(parentChanges.map(({ id, parent_id }) => updateFolder.mutateAsync({ id, data: { parent_id } })));
        }

        reorderSections.mutate(orderUpdates);
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
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                        !currentSectionId
                            ? 'bg-sidebar-accent text-sidebar-primary'
                            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                >
                    All Documents
                </Link>

                {isLoading ? (
                    <div className="space-y-0.5">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5" style={{ paddingLeft: 8 + (i % 2) * 20 }}>
                                <Skeleton className="size-4 shrink-0 rounded" />
                                <Skeleton className="size-4 shrink-0 rounded" />
                                <Skeleton className="h-4 flex-1 max-w-[120px]" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <CategorizedSections
                        sections={sections}
                        {...(currentSectionId !== undefined && { currentSectionId })}
                        onSectionsChange={handleSectionsChange}
                        onEditSection={handleEditSection}
                        onEditCategory={handleEditCategory}
                        onAddSection={(category) => openCreateFolder(category.id)}
                        onDeleteSection={handleDeleteSection}
                        onDeleteCategory={handleDeleteCategory}
                        onClose={onClose}
                        {...(sortableTreeHandlersRef != null && { treeDndHandlersRef: sortableTreeHandlersRef })}
                    />
                )}
                <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 w-full justify-start gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={openCreateCollection}
                >
                    <span className="text-base">+</span>
                    New collection
                </Button>
            </nav>

            {/* Storage & Settings */}
            <div className="border-t border-sidebar-border p-2">
                {user ? (
                    <Link to="/settings" className="block px-3 py-2.5 transition-colors hover:bg-sidebar-accent" onClick={onClose}>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-success rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${Math.min(storagePct, 100)}%` }}
                            />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5">
                            <span>
                                {formatFileSize(user.storage_used_bytes)} of {formatFileSize(user.storage_quota_bytes)} used
                            </span>
                        </div>
                    </Link>
                ) : null}
                <Link
                    to="/settings"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={onClose}
                >
                    <Settings className="size-4" />
                    Settings
                </Link>
                {user?.role === 'admin' && (
                    <Link
                        to="/admin/users"
                        className={cn(
                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            location.pathname.startsWith('/admin')
                                ? 'bg-sidebar-accent text-sidebar-primary'
                                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        )}
                        onClick={onClose}
                    >
                        <Users className="size-4" />
                        Users
                    </Link>
                )}
            </div>

            <CreateSectionModal open={createModalOpen} onOpenChange={setCreateModalOpen} parentId={createModalParent} mode={createModalMode} />
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
                    'flex flex-col border-r border-sidebar-border bg-sidebar',
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
