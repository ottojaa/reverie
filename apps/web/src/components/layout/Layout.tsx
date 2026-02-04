import { GlobalDropzone, UploadFAB, UploadModal } from '@/components/upload';
import { ReactNode, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface LayoutProps {
    children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
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
    );
}
