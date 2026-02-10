import { DocumentDetailsDrawer } from '@/components/document-viewer/DocumentDetailsDrawer';
import type { ViewerProps } from '@/components/document-viewer/viewer-registry';
import { getViewerLoader } from '@/components/document-viewer/viewer-registry';
import { ViewerToolbar } from '@/components/document-viewer/ViewerToolbar';
import { useDocument } from '@/lib/api';
import { useParams } from '@tanstack/react-router';
import { FileWarning } from 'lucide-react';
import { motion } from 'motion/react';
import { type ComponentType, useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function buildFileUrl(fileUrl: string | null): string | null {
    if (!fileUrl) return null;

    // Signed URLs from the API are relative paths
    return fileUrl.startsWith('http') ? fileUrl : `${API_BASE}${fileUrl}`;
}

/**
 * Dynamically imports the viewer component based on MIME type.
 * Avoids React.lazy + Suspense to prevent a flash of loading spinner
 * when navigating with cached document data.
 */
function useDynamicViewer(mimeType: string | undefined, filename?: string) {
    const [Viewer, setViewer] = useState<ComponentType<ViewerProps> | null>(null);

    useEffect(() => {
        if (!mimeType) {
            setViewer(null);

            return;
        }

        let cancelled = false;
        const loader = getViewerLoader(mimeType, filename);
        loader().then((mod) => {
            if (!cancelled) {
                setViewer(() => mod.default);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [mimeType, filename]);

    return Viewer;
}

export function DocumentPage() {
    const { id } = useParams({ from: '/document/$id' });
    const { data: document, isLoading, error } = useDocument(id);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const toggleDetails = useCallback(() => setIsDetailsOpen((v) => !v), []);

    // Resolve the viewer component via dynamic import (no Suspense needed)
    const ViewerComponent = useDynamicViewer(document?.mime_type, document?.original_filename);

    const fileUrl = document ? buildFileUrl(document.file_url) : null;

    // Loading state — only show on first load, not refetch
    if (isLoading) {
        return (
            <div className="relative flex h-full w-full items-center justify-center bg-background">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-col items-center gap-4">
                    <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Loading document...</p>
                </motion.div>
            </div>
        );
    }

    // Error state
    if (error || !document) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4 text-center">
                    <div className="rounded-2xl bg-destructive/10 p-5">
                        <FileWarning className="size-10 text-destructive" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-foreground">Failed to load document</p>
                        <p className="mt-1 text-xs text-muted-foreground">{error instanceof Error ? error.message : 'Document not found'}</p>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
            {/* Toolbar overlay */}
            <ViewerToolbar document={document} fileUrl={fileUrl} isDetailsOpen={isDetailsOpen} onToggleDetails={toggleDetails} />

            {/* Viewer area */}
            <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-1 overflow-hidden pt-14"
            >
                {ViewerComponent && fileUrl ? (
                    <ViewerComponent document={document} fileUrl={fileUrl} />
                ) : fileUrl && !ViewerComponent /* Viewer chunk still loading — show nothing; entrance animation covers this brief gap */ ? null : (
                    <div className="flex flex-1 items-center justify-center">
                        <p className="text-sm text-muted-foreground">No preview available</p>
                    </div>
                )}
            </motion.div>

            {/* Details drawer */}
            <DocumentDetailsDrawer document={document} isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} />
        </div>
    );
}
