import { GlobalDropzone, UploadFAB, UploadModal } from '@/components/upload';
import { SectionEditProvider } from '@/lib/SectionEditContext';
import { useSections } from '@/lib/sections';
import { MeasuringStrategy } from '@dnd-kit/core';
import type { FolderWithChildren } from '@reverie/shared';
import { ReactNode, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

const INDENTATION_WIDTH = 20;

const measuring = {
    droppable: {
        strategy: MeasuringStrategy.Always,
    },
};

interface DragData {
    type: 'documents' | 'section';
    documentIds?: string[];
    section?: FolderWithChildren;
    parentId?: string | null;
}

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { data: sections = [] } = useSections();

    return (
        <SectionEditProvider>
            <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
                <div className="flex flex-1 flex-col overflow-hidden">
                    <Header onMenuClick={() => setIsSidebarOpen((v) => !v)} />
                    <GlobalDropzone>
                        <main className="flex-1 overflow-auto">{children}</main>
                    </GlobalDropzone>
                </div>
                <UploadFAB />
                <UploadModal />
            </div>
        </SectionEditProvider>
    );
}

function findSection(sections: FolderWithChildren[], id: string): FolderWithChildren | null {
    for (const section of sections) {
        if (section.id === id) return section;
        const found = findSection(section.children, id);
        if (found) return found;
    }
    return null;
}
