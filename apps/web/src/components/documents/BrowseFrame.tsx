import { UploadFAB } from '@/components/upload';
import { useSelectionOptional } from '@/lib/selection';
import type { Document } from '@reverie/shared';
import { useEffect, type ReactNode } from 'react';
import { SelectionBanner } from './SelectionBanner';

interface BrowseFrameProps {
    /** The documents the selection banner can act on (download needs their URLs). */
    documents: Document[];
    children: ReactNode;
}

/** What the dashboard and the kind views share: the page padding, the upload button, the selection banner, and a click outside a document clearing the selection. */
export function BrowseFrame({ documents, children }: BrowseFrameProps) {
    const selection = useSelectionOptional();

    useEffect(() => {
        if (!selection) return;

        const handler = (e: MouseEvent) => {
            const target = e.target instanceof Node ? e.target : null;

            if (target && (target as Element).closest?.('[data-document-card]')) return;

            selection.clear();
        };

        document.addEventListener('click', handler);

        return () => document.removeEventListener('click', handler);
    }, [selection]);

    const hasSelection = (selection?.selectedIds.size ?? 0) > 0;

    return (
        <div className="relative flex min-h-full flex-col">
            <div className={`flex-1 p-6 transition-[padding-bottom] duration-200 ${hasSelection ? 'pb-24' : ''}`}>
                {children}
                <UploadFAB />
            </div>
            <SelectionBanner documents={documents} />
        </div>
    );
}
