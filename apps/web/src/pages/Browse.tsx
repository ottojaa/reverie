import { DocumentGrid, DocumentSkeleton, SelectionBanner } from '@/components/documents';
import { Button } from '@/components/ui/button';
import { useDocuments } from '@/lib/api';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useCurrentSection } from '@/lib/sections';
import { SelectionProvider } from '@/lib/selection';
import { useDocumentsStatus } from '@/lib/useDocumentStatus';
import { Link } from '@tanstack/react-router';
import { FolderOpen, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const SKELETON_DELAY_MS = 200;

export interface BrowsePageProps {
    sectionId?: string;
}

export function BrowsePage({ sectionId }: BrowsePageProps) {
    const section = useCurrentSection(sectionId);
    const { openEdit } = useSectionEdit();
    const { data, isLoading, error } = useDocuments({
        limit: 50,
        ...(sectionId && { folderId: sectionId }),
    });

    const documents = data?.items ?? [];
    const isEmpty = !isLoading && documents.length === 0;

    // Only show skeleton if loading lasts longer than SKELETON_DELAY_MS (avoids flash on fast loads)
    const [showSkeleton, setShowSkeleton] = useState(false);
    useEffect(() => {
        if (!isLoading) {
            setShowSkeleton(false);
            return;
        }
        const t = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
        return () => clearTimeout(t);
    }, [isLoading]);

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

    const title = section ? `${section.emoji ?? ''} ${section.name}`.trim() : 'My Files';
    const subtitle = section
        ? data?.total
            ? `${data.total} ${data.total === 1 ? 'file' : 'files'} in this section`
            : null
        : data?.total
          ? `${data.total} ${data.total === 1 ? 'file' : 'files'} in your collection`
          : null;

    return (
        <div className="flex flex-1 flex-col p-6">
            <div className="mb-6">
                {sectionId && (
                    <nav className="mb-1 flex justify-between items-center text-sm text-muted-foreground gap-2">
                        <div className="items-center gap-2">
                            <Link to="/browse" className="hover:text-foreground">
                                All Documents
                            </Link>
                            <span>/</span>
                            <span className="text-foreground">{section?.name ?? 'Section'}</span>
                        </div>
                        <div>
                            {section && (
                                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openEdit(section)}>
                                    <Pencil className="mr-2 size-4" />
                                    Edit section
                                </Button>
                            )}
                        </div>
                    </nav>
                )}
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-semibold">{title}</h1>
                        {section?.description && <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>}
                        <p className="text-primary mt-2">{subtitle}</p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">Failed to load documents. Please try again.</div>
            )}

            {isLoading ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {Array.from({ length: 12 }).map((_, i) =>
                        showSkeleton ? (
                            <DocumentSkeleton key={i} />
                        ) : (
                            <div key={i} className="opacity-0 pointer-events-none" aria-hidden>
                                <DocumentSkeleton />
                            </div>
                        ),
                    )}
                </div>
            ) : isEmpty ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8">
                    <div className="flex flex-col items-center text-center">
                        <FolderOpen className="size-12 text-muted-foreground/50" />
                        <p className="mt-4 text-lg font-medium">{sectionId ? 'No documents in this section' : 'No documents yet'}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {sectionId ? 'Move or upload files here' : 'Drop files here or use the upload button'}
                        </p>
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
