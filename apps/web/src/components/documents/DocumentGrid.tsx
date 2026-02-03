import type { Document } from '@reverie/shared';
import { AnimatePresence } from 'motion/react';
import { DocumentCard } from './DocumentCard';

interface DocumentGridProps {
    documents: Document[];
    isLoading?: boolean;
}

export function DocumentGrid({ documents, isLoading }: DocumentGridProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-muted" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <AnimatePresence mode="popLayout">
                {documents.map((doc) => (
                    <DocumentCard key={doc.id} document={doc} />
                ))}
            </AnimatePresence>
        </div>
    );
}
