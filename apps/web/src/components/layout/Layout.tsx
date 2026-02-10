import { GlobalDropzone, UploadModal } from '@/components/upload';
import { SectionEditProvider } from '@/lib/SectionEditContext';
import { dndMeasuring, useDefaultSensors } from '@/lib/dnd';
import { SelectionProvider } from '@/lib/selection';
import type { Announcements, DragCancelEvent, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, pointerWithin } from '@dnd-kit/core';
import { ReactNode, useRef, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

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
    const sortableTreeHandlersRef = useRef<SortableTreeHandlers | null>(null);
    const defaultSensors = useDefaultSensors();

    const defaultAnnouncements: Announcements = {
        onDragStart: () => 'Picked up.',
        onDragMove: () => undefined,
        onDragOver: () => undefined,
        onDragEnd: () => 'Dropped.',
        onDragCancel: () => 'Moving cancelled.',
    };

    return (
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
                    <div className="flex h-screen overflow-hidden bg-background">
                        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} sortableTreeHandlersRef={sortableTreeHandlersRef} />
                        <div className="flex flex-1 flex-col overflow-hidden">
                            <Header onMenuClick={() => setIsSidebarOpen((v) => !v)} />
                            <GlobalDropzone>
                                <main className="flex-1 overflow-auto">{children}</main>
                            </GlobalDropzone>
                        </div>
                        <UploadModal />
                    </div>
                </DndContext>
            </SelectionProvider>
        </SectionEditProvider>
    );
}
