import type { Document } from '@reverie/shared';
import { useMemo, useRef } from 'react';

function isDocumentProcessing(doc: Document): boolean {
    return (
        doc.ocr_status === 'processing' ||
        doc.ocr_status === 'pending' ||
        doc.thumbnail_status === 'processing' ||
        doc.thumbnail_status === 'pending' ||
        (doc.llm_status ?? 'skipped') === 'processing' ||
        (doc.llm_status ?? 'skipped') === 'pending'
    );
}

export function useProcessingProgress(documents: Document[]) {
    const totalFilesRef = useRef(0);

    return useMemo(() => {
        const processingDocs = documents.filter(isDocumentProcessing);
        const processingCount = processingDocs.length;

        if (processingCount > 0) {
            totalFilesRef.current = Math.max(totalFilesRef.current, processingCount);
        } else {
            totalFilesRef.current = 0;
        }

        const totalFiles = totalFilesRef.current;
        const completedFiles = totalFiles - processingCount;
        const isProcessing = processingCount > 0;

        return {
            processingDocs,
            processingDocumentIds: processingDocs.map((d) => d.id),
            processingCount,
            totalFiles,
            completedFiles,
            isProcessing,
        };
    }, [documents]);
}
