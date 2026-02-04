import { DocumentGrid, SelectionBanner } from '@/components/documents';
import { useDocuments } from '@/lib/api';
import { SelectionProvider } from '@/lib/selection';
import { useDocumentsStatus } from '@/lib/useDocumentStatus';
import { FolderOpen, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

export function BrowsePage() {
    const { data, isLoading, error } = useDocuments({ limit: 50 });

    const documents = data?.items ?? [];
    const isEmpty = !isLoading && documents.length === 0;

    // Subscribe to real-time updates for documents that are still processing
    const processingDocumentIds = useMemo(
        () =>
            documents
                .filter(
                    (doc) =>
                        doc.ocr_status === 'processing' ||
                        doc.ocr_status === 'pending' ||
                        doc.thumbnail_status === 'processing' ||
                        doc.thumbnail_status === 'pending',
                )
                .map((doc) => doc.id),
        [documents],
    );

    useDocumentsStatus(processingDocumentIds);

    return (
        <div className="flex flex-1 flex-col p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-semibold">My Files</h1>
                <p className="text-muted-foreground">
                    {data?.total ? `${data.total} ${data.total === 1 ? 'file' : 'files'} in your collection` : 'Navigate through your documents'}
                </p>
            </div>

            {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">Failed to load documents. Please try again.</div>
            )}

            {isLoading ? (
                <div className="flex flex-1 items-center justify-center">
                    <div className="flex flex-col items-center text-center">
                        <Loader2 className="size-12 animate-spin text-muted-foreground/50" />
                        <p className="mt-4 text-lg font-medium">Loading documents...</p>
                    </div>
                </div>
            ) : isEmpty ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8">
                    <div className="flex flex-col items-center text-center">
                        <FolderOpen className="size-12 text-muted-foreground/50" />
                        <p className="mt-4 text-lg font-medium">No documents yet</p>
                        <p className="mt-1 text-sm text-muted-foreground">Drop files here or use the upload button</p>
                    </div>
                </div>
            ) : (
                <SelectionProvider>
                    <SelectionBanner />
                    <DocumentGrid documents={documents} isLoading={false} />
                </SelectionProvider>
            )}
        </div>
    );
}
