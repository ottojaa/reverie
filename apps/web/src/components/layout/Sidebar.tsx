import { CreateSectionModal } from '@/components/sections';
import { useConfirm } from '@/lib/confirm';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { sectionsToParentMap, useDeleteFolder, useReorderSections, useSections, useUpdateFolder } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren } from '@reverie/shared';
import { Link, useParams } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { SortableTree } from '../sortableTree/SortableTree';
import type { TreeItems } from '../sortableTree/types';
import { treeItemsToOrderUpdates, treeItemsToParentMap } from '../sortableTree/utilities';
import { Skeleton } from '../ui/skeleton';

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
    const reorderSections = useReorderSections();
    const updateFolder = useUpdateFolder();

    const { openEdit } = useSectionEdit();
    const [createModalParent, setCreateModalParent] = useState<string | null | undefined>(undefined);
    const navRef = useRef<HTMLElement>(null);

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

    const handleSectionsChange = (newItems: TreeItems) => {
        const orderUpdates = treeItemsToOrderUpdates(newItems);
        const newParentMap = treeItemsToParentMap(newItems);
        const currentParentMap = sectionsToParentMap(sections);
        newParentMap.forEach((newParentId, id) => {
            if (currentParentMap.get(id) !== newParentId) {
                updateFolder.mutate({ id, data: { parent_id: newParentId } });
            }
        });
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
                        'mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
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
                ) : sections.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">No sections yet</div>
                ) : (
                    <SortableTree
                        sections={sections}
                        currentSectionId={currentSectionId}
                        indentationWidth={20}
                        collapsible
                        onSectionsChange={handleSectionsChange}
                        onEditSection={handleEditSection}
                        onAddSubSection={(section) => handleAddSubSection(section.id)}
                        onDeleteSection={handleDeleteSection}
                    />
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
