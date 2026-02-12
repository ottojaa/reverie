import { Button } from '@/components/ui/button';
import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Download, Edit3, Info, Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ViewerToolbarProps {
    document: Document;
    fileUrl: string | null;
    isDetailsOpen: boolean;
    onToggleDetails: () => void;
    /** Whether this file type supports editing (future) */
    canEdit?: boolean;
}

/**
 * Thin animated bar that appears below the toolbar when any job is still running.
 * Indeterminate left-to-right sweep using the teal primary accent.
 */
function ProcessingBar({ document }: { document: Document }) {
    const isProcessing =
        document.ocr_status === 'processing' ||
        document.ocr_status === 'pending' ||
        document.thumbnail_status === 'processing' ||
        document.thumbnail_status === 'pending' ||
        document.llm_status === 'processing' ||
        document.llm_status === 'pending';

    return (
        <AnimatePresence>
            {isProcessing && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-x-0 bottom-0 z-10 h-[2px] overflow-hidden"
                >
                    <div
                        className="h-full w-full bg-linear-to-r from-transparent via-primary to-transparent"
                        style={{
                            backgroundSize: '200% 100%',
                            animation: 'processingSlide 1.8s ease-in-out infinite',
                        }}
                    />
                    {/* Soft glow underneath */}
                    <div
                        className="absolute inset-x-0 top-0 h-1 blur-sm bg-linear-to-r from-transparent via-primary/50 to-transparent"
                        style={{
                            backgroundSize: '200% 100%',
                            animation: 'processingSlide 1.8s ease-in-out infinite',
                        }}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
}

const processingSlideKeyframes = `
@keyframes processingSlide {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
`;

export function ViewerToolbar({ document, fileUrl, isDetailsOpen, onToggleDetails, canEdit = false }: ViewerToolbarProps) {
    const fileConfig = getFileTypeConfig(document.mime_type);
    const isTextLike = document.mime_type.startsWith('text/') || document.mime_type === 'application/json';

    return (
        <>
            <style>{processingSlideKeyframes}</style>
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
                    <Button variant="ghost" size="icon-sm" asChild className="shrink-0">
                        <Link to="/browse">
                            <ArrowLeft className="size-4" />
                        </Link>
                    </Button>

                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{document.original_filename}</p>
                        <p className="hidden text-xs text-muted-foreground md:block">{fileConfig.label}</p>
                    </div>
                </div>

                {/* Right: actions */}
                <div className="relative z-10 flex items-center gap-1">
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
                        <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground">
                            <a href={fileUrl} download={document.original_filename} target="_blank" rel="noopener noreferrer">
                                <Download className="size-4" />
                            </a>
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

                {/* Processing indicator — thin animated bar at bottom of toolbar */}
                <ProcessingBar document={document} />
            </motion.div>
        </>
    );
}
