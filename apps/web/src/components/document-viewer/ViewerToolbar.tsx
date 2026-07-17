import { Button } from '@/components/ui/button';
import { buildDownloadUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, Download, Edit3, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback } from 'react';
import { InsightTitle } from './insights/InsightTitle';

interface ViewerToolbarProps {
    document: Document;
    fileUrl: string | null;
    isInsightsOpen: boolean;
    onToggleInsights: () => void;
    /** Whether this file type supports editing */
    canEdit?: boolean;
    /** Whether edit mode is active (e.g. image editor) */
    isEditMode?: boolean;
    /** Toggle edit mode */
    onToggleEdit?: () => void;
}

export function ViewerToolbar({ document, fileUrl, isInsightsOpen, onToggleInsights, canEdit = false, isEditMode = false, onToggleEdit }: ViewerToolbarProps) {
    const router = useRouter();
    const isTextLike = document.mime_type.startsWith('text/') || document.mime_type === 'application/json';

    const handleDownload = useCallback(() => {
        if (!fileUrl) return;

        // Navigate to the signed URL with ?download=1 so the server sets
        // Content-Disposition: attachment. This downloads on every browser
        // (incl. iOS Safari) and streams directly — no fetch/CORS/blob dance.
        const a = window.document.createElement('a');

        a.href = buildDownloadUrl(fileUrl, document.original_filename);
        a.rel = 'noopener';
        a.click();
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

            {/* Left: back + title / AI insight teaser */}
            <div className="relative z-10 flex min-w-0 items-center gap-2">
                <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => router.history.back()}>
                    <ArrowLeft className="size-4" />
                </Button>

                <InsightTitle document={document} isOpen={isInsightsOpen} onToggle={onToggleInsights} />
            </div>

            {/* Right: actions */}
            <div className="relative z-10 flex items-center gap-3">
                {/* Edit button (text files use inline edit; images use image editor) */}
                {!isTextLike && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canEdit}
                        onClick={canEdit ? onToggleEdit : undefined}
                        title={canEdit ? (isEditMode ? 'Exit edit' : 'Edit') : 'Editing coming soon'}
                        className={cn('text-muted-foreground', canEdit && isEditMode && 'bg-primary/10 text-primary')}
                    >
                        {canEdit ? <Edit3 className="size-4" /> : <Pencil className="size-4" />}
                    </Button>
                )}

                {/* Download */}
                {fileUrl && (
                    <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Download" className="text-muted-foreground">
                        <Download className="size-4" />
                    </Button>
                )}
            </div>
        </motion.div>
    );
}
