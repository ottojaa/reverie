import type { FolderWithChildren } from '@reverie/shared';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { EditSectionModal } from '@/components/sections';

interface SectionEditContextValue {
    openEdit: (section: FolderWithChildren | null) => void;
}

const SectionEditContext = createContext<SectionEditContextValue | null>(null);

export function useSectionEdit(): SectionEditContextValue {
    const ctx = useContext(SectionEditContext);
    if (!ctx) throw new Error('useSectionEdit must be used within SectionEditProvider');
    return ctx;
}

export function SectionEditProvider({ children }: { children: ReactNode }) {
    const [section, setSection] = useState<FolderWithChildren | null>(null);

    const openEdit = useCallback((s: FolderWithChildren | null) => {
        setSection(s);
    }, []);

    return (
        <SectionEditContext.Provider value={{ openEdit }}>
            {children}
            <EditSectionModal
                open={section !== null}
                onOpenChange={(open) => !open && setSection(null)}
                section={section}
            />
        </SectionEditContext.Provider>
    );
}
