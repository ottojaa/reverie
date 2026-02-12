import { useUpload } from '@/lib/upload';
import type { Document } from '@reverie/shared';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { DocumentCard } from './DocumentCard';

interface DocumentGridProps {
    documents: Document[];
    isLoading?: boolean;
}

export function DocumentGrid({ documents, isLoading }: DocumentGridProps) {
    const { recentlyCompletedDocumentIds, markPulseComplete } = useUpload();
    const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());

    // Consume IDs from context into local state, then clear context immediately.
    // This way navigating away + back won't re-trigger the pulse animation.
    useEffect(() => {
        if (recentlyCompletedDocumentIds.length === 0) return;

        setPulsingIds((prev) => {
            const next = new Set(prev);

            for (const id of recentlyCompletedDocumentIds) {
                next.add(id);
            }

            return next;
        });

        for (const id of recentlyCompletedDocumentIds) {
            markPulseComplete(id);
        }
    }, [recentlyCompletedDocumentIds, markPulseComplete]);

    const handlePulseComplete = useCallback((id: string) => {
        setPulsingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);

            return next;
        });
    }, []);

    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-4/3 animate-pulse rounded-xl bg-muted" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <AnimatePresence mode="popLayout">
                {documents.map((doc) => (
                    <DocumentCard
                        key={doc.id}
                        document={doc}
                        orderedIds={documents.map((d) => d.id)}
                        shouldPulse={pulsingIds.has(doc.id)}
                        onPulseComplete={() => handlePulseComplete(doc.id)}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
}
