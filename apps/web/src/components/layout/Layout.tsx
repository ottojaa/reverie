import { OrganizeChatProvider } from '@/lib/api/OrganizeChatContext';
import { GlobalDropzone, UploadModal } from '@/components/upload';
import { OrganizeModal } from '@/components/organize';
import { usePathnameTracker } from '@/lib/hooks/useNavigationDirection';
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

export interface SortableTreeHandlers {
    handleDragStart: (event: DragStartEvent) => void;
    handleDragOver: (event: DragOverEvent) => void;
    handleDragMove: (...args: unknown[]) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    handleDragCancel: (event: DragCancelEvent) => void;
    resetState: () => void;
    sensors?: ReturnType<typeof useDefaultSensors>;
    announcements?: Announcements;
}

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [organizeOpen, setOrganizeOpen] = useState(false);
    const [organizeMinimized, setOrganizeMinimized] = useState(false);
    const sortableTreeHandlersRef = useRef<SortableTreeHandlers | null>(null);
    const mainRef = useRef<HTMLElement | null>(null);
    const defaultSensors = useDefaultSensors();

    const openOrganize = useCallback(() => {
        setOrganizeOpen(true);
        setOrganizeMinimized(false);
    }, []);

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

    // Global pathname tracker for useIsReturningFromDocument
    usePathnameTracker();

    const defaultAnnouncements: Announcements = {
        onDragStart: () => 'Picked up.',
        onDragMove: () => undefined,
        onDragOver: () => undefined,
        onDragEnd: () => 'Dropped.',
        onDragCancel: () => 'Moving cancelled.',
    };

    return (
        <OrganizeContext.Provider value={{ openOrganize }}>
        <OrganizeChatProvider>
        <SectionEditProvider>
            <SelectionProvider>
                <DndContext
                    sensors={defaultSensors}
                    collisionDetection={pointerWithin}
                    measuring={dndMeasuring}
                    accessibility={{
                        get announcements() {
                            return sortableTreeHandlersRef.current?.announcements ?? defaultAnnouncements;
                        },
                    }}
                    onDragStart={(e) => sortableTreeHandlersRef.current?.handleDragStart?.(e)}
                    onDragOver={(e) => sortableTreeHandlersRef.current?.handleDragOver?.(e)}
                    onDragMove={(e) => sortableTreeHandlersRef.current?.handleDragMove?.(e)}
                    onDragEnd={(e) => sortableTreeHandlersRef.current?.handleDragEnd?.(e)}
                    onDragCancel={(e) => sortableTreeHandlersRef.current?.handleDragCancel?.(e)}
                >
                    <div className="flex h-dvh overflow-hidden bg-background">
                        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} sortableTreeHandlersRef={sortableTreeHandlersRef} />
                        <div className="flex flex-1 flex-col overflow-hidden">
                            <Header onMenuClick={() => setIsSidebarOpen((v) => !v)} />
                            <GlobalDropzone>
                                <ScrollContainerProvider value={mainRef}>
                                    <main ref={mainRef} id="main-scroll-area" data-scroll-restoration-id="main-scroll-area" className="flex-1 overflow-auto">
                                        {children}
                                    </main>
                                </ScrollContainerProvider>
                            </GlobalDropzone>
                        </div>
                        <UploadModal />
                        <OrganizeModal
                            open={organizeOpen}
                            onOpenChange={setOrganizeOpen}
                            isMinimized={organizeMinimized}
                            setIsMinimized={setOrganizeMinimized}
                        />
                    </div>
                </DndContext>
            </SelectionProvider>
        </SectionEditProvider>
        </OrganizeChatProvider>
        </OrganizeContext.Provider>
    );
}
