import { GlobalDropzone, UploadModal } from '@/components/upload';
import { OrganizeModal } from '@/components/organize';
import { ScrollContainerProvider } from '@/lib/ScrollContainerContext';
import { SectionEditProvider } from '@/lib/SectionEditContext';
import { dndMeasuring, useDefaultSensors } from '@/lib/dnd';
import { SelectionProvider } from '@/lib/selection';
import type { Announcements, DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, pointerWithin } from '@dnd-kit/core';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

// ── Organize modal context ────────────────────────────────────────────────────

interface OrganizeContextType {
    openOrganize: () => void;
}

const OrganizeContext = createContext<OrganizeContextType>({ openOrganize: () => undefined });

export function useOrganize() {
    return useContext(OrganizeContext);
}

/** What the sidebar's folder tree does with the drags of the layout's drag context. */
export interface TreeDragHandlers {
    handleDragStart: (event: DragStartEvent) => void;
    handleDragOver: (event: DragOverEvent) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    handleDragCancel: (event: DragCancelEvent) => void;
}

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [organizeOpen, setOrganizeOpen] = useState(false);
    const treeDragHandlersRef = useRef<TreeDragHandlers | null>(null);
    const mainRef = useRef<HTMLElement | null>(null);
    const defaultSensors = useDefaultSensors();

    const openOrganize = useCallback(() => setOrganizeOpen(true), []);

    // Global keyboard shortcut: Cmd/Ctrl+Shift+O
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                setOrganizeOpen((v) => !v);
            }
        };

        document.addEventListener('keydown', handler);

        return () => document.removeEventListener('keydown', handler);
    }, []);

    const defaultAnnouncements: Announcements = {
        onDragStart: () => 'Picked up.',
        onDragMove: () => undefined,
        onDragOver: () => undefined,
        onDragEnd: () => 'Dropped.',
        onDragCancel: () => 'Moving cancelled.',
    };

    return (
        <OrganizeContext.Provider value={{ openOrganize }}>
            <SectionEditProvider>
                <SelectionProvider>
                    <DndContext
                        sensors={defaultSensors}
                        collisionDetection={pointerWithin}
                        measuring={dndMeasuring}
                        accessibility={{ announcements: defaultAnnouncements }}
                        onDragStart={(e) => treeDragHandlersRef.current?.handleDragStart(e)}
                        onDragOver={(e) => treeDragHandlersRef.current?.handleDragOver(e)}
                        onDragEnd={(e) => treeDragHandlersRef.current?.handleDragEnd(e)}
                        onDragCancel={(e) => treeDragHandlersRef.current?.handleDragCancel(e)}
                    >
                        <div className="flex h-dvh overflow-hidden bg-background">
                            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} treeDragHandlersRef={treeDragHandlersRef} />
                            <div className="flex flex-1 flex-col overflow-hidden">
                                <Header onMenuClick={() => setIsSidebarOpen((v) => !v)} />
                                <GlobalDropzone>
                                    <ScrollContainerProvider value={mainRef}>
                                        <main
                                            ref={mainRef}
                                            id="main-scroll-area"
                                            data-scroll-restoration-id="main-scroll-area"
                                            className="flex-1 overflow-auto"
                                        >
                                            {children}
                                        </main>
                                    </ScrollContainerProvider>
                                </GlobalDropzone>
                            </div>
                            <UploadModal />
                            <OrganizeModal open={organizeOpen} onOpenChange={setOrganizeOpen} />
                        </div>
                    </DndContext>
                </SelectionProvider>
            </SectionEditProvider>
        </OrganizeContext.Provider>
    );
}
