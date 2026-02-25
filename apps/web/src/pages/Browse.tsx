import { DocumentGrid, DocumentSkeleton, EmptyDocumentsState, SelectionBanner } from '@/components/documents';
import { Button } from '@/components/ui/button';
import { ProcessingIndicator } from '@/components/ui/ProcessingIndicator';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { UploadFAB } from '@/components/upload';
import { useInfiniteDocuments } from '@/lib/api';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useCurrentSection } from '@/lib/sections';
import { useSelectionOptional } from '@/lib/selection';
import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

const SKELETON_DELAY_MS = 200;

export interface BrowsePageProps {
    sectionId?: string;
}

export function BrowsePage({ sectionId }: BrowsePageProps) {
    const section = useCurrentSection(sectionId);
    const { openEdit } = useSectionEdit();
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

    const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteDocuments({
        ...(sectionId && { folderId: sectionId }),
    });

    const documents = data?.pages.flatMap((p) => p.items) ?? [];
    const total = data?.pages[0]?.total ?? 0;
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

    const title = section ? section.name : 'My Files';
    const subtitle = section
        ? total
            ? `${total} ${total === 1 ? 'file' : 'files'} in this folder`
            : null
        : total
          ? `${total} ${total === 1 ? 'file' : 'files'} in your collection`
          : null;

    return (
        <div className="relative flex min-h-full flex-col p-6">
            <ProcessingIndicator
                documents={documents}
                variant="badge"
                className="absolute top-6 right-6"
                visible={!isLoading}
            />
            <div className="mb-6">
                {sectionId && (
                    <nav className="mb-1 flex justify-between items-center text-sm gap-2">
                        <div className="items-center gap-2">
                            <h1 className="flex items-center gap-2 text-2xl font-semibold">
                                {section?.emoji && <SectionIcon value={section.emoji} className="size-7" />}
                                {title}
                            </h1>
                        </div>
                        <div>
                            {section && (
                                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openEdit(section)}>
                                    <Pencil className="mr-2 size-4" />
                                    Edit folder
                                </Button>
                            )}
                        </div>
                    </nav>
                )}
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <p className="mt-2 text-sm text-muted-foreground">{section?.description}</p>
                        <p className="text-primary mt-2 text-sm">{subtitle}</p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">Failed to load documents. Please try again.</div>
            )}

            {isLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, i) =>
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
                <EmptyDocumentsState isFolderView={!!sectionId} />
            ) : (
                <>
                    <SelectionBanner />
                    <DocumentGrid documents={documents} isLoading={false} fetchNextPage={fetchNextPage} hasNextPage={hasNextPage && !isFetchingNextPage} />
                    {isFetchingNextPage && (
                        <div className="mt-4 flex justify-center">
                            <div className="aspect-4/3 h-8 w-24 animate-pulse rounded-xl bg-muted" />
                        </div>
                    )}
                </>
            )}
            <UploadFAB />
        </div>
    );
}
