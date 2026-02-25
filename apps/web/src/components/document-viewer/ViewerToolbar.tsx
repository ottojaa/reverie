import { Button } from '@/components/ui/button';
import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { Spinner } from '@/components/ui/spinner';
import { authenticatedFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, Download, Edit3, Info, Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useState } from 'react';

interface ViewerToolbarProps {
    document: Document;
    fileUrl: string | null;
    isDetailsOpen: boolean;
    onToggleDetails: () => void;
    /** Whether this file type supports editing (future) */
    canEdit?: boolean;
}

function isDocumentProcessing(document: Document) {
    return (
        document.ocr_status === 'processing' ||
        document.ocr_status === 'pending' ||
        document.thumbnail_status === 'processing' ||
        document.thumbnail_status === 'pending' ||
        document.llm_status === 'processing' ||
        document.llm_status === 'pending'
    );
}

function ProcessingIndicator({ document }: { document: Document }) {
    const isProcessing = isDocumentProcessing(document);

    return (
        <AnimatePresence>
            {isProcessing && (
                <motion.span
                    key="processing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                    <Spinner className="size-3" />
                    Processing...
                </motion.span>
            )}
        </AnimatePresence>
    );
}

export function ViewerToolbar({ document, fileUrl, isDetailsOpen, onToggleDetails, canEdit = false }: ViewerToolbarProps) {
    const router = useRouter();
    const [isDownloading, setIsDownloading] = useState(false);
    const fileConfig = getFileTypeConfig(document.mime_type);
    const isTextLike = document.mime_type.startsWith('text/') || document.mime_type === 'application/json';

    const handleDownload = useCallback(async () => {
        if (!fileUrl) return;

        setIsDownloading(true);

        try {
            const res = await authenticatedFetch(fileUrl);

            if (!res.ok) throw new Error('Download failed');

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = window.document.createElement('a');
            a.href = url;
            a.download = document.original_filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            // Fallback: open in new tab (original behavior)
            window.open(fileUrl, '_blank', 'noopener,noreferrer');
        } finally {
            setIsDownloading(false);
        }
    }, [fileUrl, document.original_filename]);

    return (
        <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 md:px-6"
        >
            {/* Glass background */}
            <div className="absolute inset-0 bg-background/70 backdrop-blur-xl mask-[linear-gradient(to_bottom,black_70%,transparent)]" />

            {/* Left: back + filename */}
            <div className="relative z-10 flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => router.history.back()}>
                    <ArrowLeft className="size-4" />
                </Button>

                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{document.original_filename}</p>
                    <p className="hidden text-xs text-muted-foreground md:block">{fileConfig.label}</p>
                </div>
            </div>

            {/* Right: actions */}
            <div className="relative z-10 flex items-center gap-3">
                <ProcessingIndicator document={document} />
                {/* Edit button (text files only for now — others show "coming soon") */}
                {!isTextLike && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canEdit}
                        title={canEdit ? 'Edit' : 'Editing coming soon'}
                        className="text-muted-foreground"
                    >
                        {canEdit ? <Edit3 className="size-4" /> : <Pencil className="size-4" />}
                    </Button>
                )}

                {/* Download */}
                {fileUrl && (
                    <Button variant="ghost" size="icon-sm" onClick={handleDownload} disabled={isDownloading} title="Download" className="text-muted-foreground">
                        {isDownloading ? <Spinner className="size-4" /> : <Download className="size-4" />}
                    </Button>
                )}

                {/* Info / details toggle */}
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onToggleDetails}
                    className={cn('text-muted-foreground', isDetailsOpen && 'bg-secondary text-foreground')}
                >
                    <Info className="size-4" />
                </Button>
            </div>
        </motion.div>
    );
}
