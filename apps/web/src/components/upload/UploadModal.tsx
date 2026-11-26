import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatFileSize } from '@/lib/commonhelpers';
import { useFileHashes } from '@/lib/hash/useFileHashes';
import { useIsFolderGone } from '@/lib/folders/gone';
import { findFolder } from '@/lib/folders/tree.js';
import { useSections } from '@/lib/sections';
import { isRetryable, useUpload } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { AlertCircle, Loader2, RefreshCw, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useCountdown } from '@/lib/hooks/useCountdown';
import { DuplicateReviewDialog } from './DuplicateReviewDialog';
import { UploadDestinationMenu } from './UploadDestinationMenu';
import { UploadFileItem } from './UploadFileItem';
import { useUploadCheck } from './useUploadCheck';

function AnimatedCheckCircle({ className }: { className?: string }) {
    return (
        <motion.svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('size-6', className)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
        >
            <motion.circle
                cx="12"
                cy="12"
                r="10"
                pathLength={1}
                strokeDasharray={1}
                initial={{ strokeDashoffset: 1 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
            />
            <motion.path
                d="M9 12l2 2 4-4"
                pathLength={1}
                strokeDasharray={1}
                initial={{ strokeDashoffset: 1 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{ duration: 0.8, delay: 0.35, ease: [0.33, 1, 0.53, 1] }}
            />
        </motion.svg>
    );
}

const UPLOAD_WEIGHT = 50;
const PROCESSING_WEIGHT = 50;

const ALL_COMPLETE_CLOSE_DELAY_MS = 2000;

function useOverallProgress() {
    const { files, isUploading, uploadBytesLoaded, uploadBytesTotal } = useUpload();

    return useMemo(() => {
        const total = files.length;

        if (total === 0) {
            return {
                percent: 0,
                completedCount: 0,
                total: 0,
                phase: 'idle' as const,
                phaseLabel: '',
            };
        }

        const completedCount = files.filter((f) => f.status === 'complete' || f.status === 'error').length;

        // Phase 1: Upload (0% → 50%) – smooth byte-level progress
        if (isUploading && uploadBytesTotal > 0) {
            const uploadRatio = uploadBytesLoaded / uploadBytesTotal;
            const percent = Math.min(100, uploadRatio * UPLOAD_WEIGHT);

            return {
                percent,
                completedCount,
                total,
                phase: 'uploading' as const,
                phaseLabel: `Uploading ${formatFileSize(uploadBytesLoaded)} of ${formatFileSize(uploadBytesTotal)}`,
            };
        }

        // Phase 2: Processing (50% → 100%) – per-file completion
        const processingRatio = completedCount / total;
        const percent = UPLOAD_WEIGHT + processingRatio * PROCESSING_WEIGHT;

        return {
            percent,
            completedCount,
            total,
            phase: 'processing' as const,
            phaseLabel: completedCount === total ? '' : `Generating previews \u2014 ${completedCount} of ${total}`,
        };
    }, [files, isUploading, uploadBytesLoaded, uploadBytesTotal]);
}

export function UploadModal() {
    const params = useParams({ strict: false });
    const currentSectionId = (params as { sectionId?: string }).sectionId;
    const { data: sectionsTree = [] } = useSections();
    // Undefined follows the page: the folder in the URL, else the top level (null).
    const [picked, setPicked] = useState<string | null>();
    // A picked folder trashed since is no destination: the choice goes back to following the page.
    const isPickGone = useIsFolderGone(picked);
    const targetFolderId = picked === undefined || isPickGone ? (currentSectionId ?? null) : picked;

    useEffect(() => {
        setPicked(undefined);
    }, [currentSectionId]);

    const { files, isModalOpen, closeModal, startUpload, removeFile, clearCompleted, clearFailed, retryFile, stats, isUploading, recordCompletedDocumentIds } =
        useUpload();

    const queryClient = useQueryClient();
    const prevAllComplete = useRef(false);
    const [successPhase, setSuccessPhase] = useState(false);
    const hashes = useFileHashes(files);
    const uploadCheck = useUploadCheck({ files, hashes, folderId: targetFolderId, startUpload, removeFile });

    const { percent, completedCount, total, phase, phaseLabel } = useOverallProgress();

    const hasQueued = stats.queued > 0;
    const hasFailed = stats.error > 0;
    const hasRetryable = files.some(isRetryable);
    const allComplete = total > 0 && stats.complete === total;
    const allCompleteRef = useRef(allComplete);
    allCompleteRef.current = allComplete;

    const uploadStarted = stats.uploading > 0 || stats.processing > 0 || stats.complete > 0;

    const { isCounting, seconds, startCountdown } = useCountdown();

    useEffect(() => {
        if (!allComplete) {
            prevAllComplete.current = false;

            return;
        }

        // Already started countdown (effect re-ran due to files/other deps changing) – don't restart
        if (prevAllComplete.current) return;

        prevAllComplete.current = true;
        const completedIds = files.filter((f) => f.status === 'complete' && f.documentId).map((f) => f.documentId!);
        recordCompletedDocumentIds(completedIds);
        setSuccessPhase(true);

        const n = stats.complete;

        startCountdown(ALL_COMPLETE_CLOSE_DELAY_MS / 1000);

        const timer = setTimeout(() => {
            closeModal();
            clearCompleted();
            clearFailed();
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            queryClient.invalidateQueries({ queryKey: ['user'] });
            toast.success(n === 1 ? '1 document uploaded' : `${n} documents uploaded`);
        }, ALL_COMPLETE_CLOSE_DELAY_MS);

        return () => {
            // Only clear when transitioning away from allComplete; avoid resetting countdown on dep changes
            if (!allCompleteRef.current) {
                clearTimeout(timer);
                setSuccessPhase(false);
            }
        };
    }, [allComplete, stats.complete, closeModal, queryClient, clearCompleted, clearFailed, files, recordCompletedDocumentIds, startCountdown]);

    if (files.length === 0) {
        return null;
    }

    return (
        <>
            <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
                <DialogContent
                    showCloseButton={true}
                    className="flex max-h-[85vh] w-full max-w-lg flex-col max-md:h-full max-md:max-h-none max-md:rounded-none sm:max-w-lg md:max-w-xl"
                >
                    <DialogHeader>
                        <DialogTitle>
                            {isUploading ? 'Uploading' : 'Upload'} {files.length} {files.length === 1 ? 'file' : 'files'}
                        </DialogTitle>
                        <UploadDestinationMenu folderId={targetFolderId} onPick={setPicked} />
                    </DialogHeader>

                    {/* Linear progress bar (Motion) – only after upload has started. It has no exit animation: a leaving
                        element keeps its last render, which would still count the bytes of files that have just failed. */}
                    <AnimatePresence initial={false}>
                        {uploadStarted && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                transition={{ duration: 0.2 }}
                                className="space-y-2 overflow-hidden"
                                layout
                            >
                                <div className="flex items-center justify-center gap-2">
                                    {successPhase ? (
                                        <span className="flex items-center gap-1.5 text-sm text-success">
                                            <AnimatedCheckCircle />
                                        </span>
                                    ) : (
                                        phase !== 'idle' && (
                                            <span
                                                className={cn(
                                                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                    phase === 'uploading' && 'bg-accent/15 text-accent',
                                                    phase === 'processing' && 'bg-accent/15 text-accent',
                                                )}
                                            >
                                                {phase === 'uploading' ? 'Uploading' : 'Processing'}
                                            </span>
                                        )
                                    )}
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                    <motion.div
                                        className="h-full rounded-full bg-primary"
                                        initial={false}
                                        animate={{ width: `${percent}%` }}
                                        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                                    />
                                </div>
                                <p className="text-center text-sm text-muted-foreground">{phaseLabel || `${completedCount} of ${total} files complete`}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* File list – collapse to 0 when successPhase for smooth modal shrink */}
                    <motion.div className="min-h-0 overflow-hidden" layout>
                        <div className="max-h-80 overflow-y-auto">
                            <AnimatePresence initial={false}>
                                {files.map((file) => (
                                    <motion.div
                                        key={file.id}
                                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                                        animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <UploadFileItem file={file} hash={hashes[file.id]} onRemove={removeFile} onRetry={retryFile} disableExitAnimation />
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </motion.div>

                    {/* Status / actions */}
                    <div className="flex flex-wrap items-center gap-2">
                        {hasFailed && !isUploading && (
                            <span className="flex items-center gap-1.5 text-sm text-destructive">
                                <AlertCircle className="size-4" />
                                {stats.error} failed
                            </span>
                        )}
                    </div>

                    <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
                        <div className="flex gap-2">
                            {hasFailed && !isUploading && (
                                <>
                                    <Button variant="ghost" size="sm" onClick={clearFailed}>
                                        Clear failed
                                    </Button>
                                    {hasRetryable && (
                                        <Button variant="outline" size="sm" disabled={uploadCheck.isChecking} onClick={uploadCheck.retry}>
                                            <RefreshCw className="mr-2 size-4" />
                                            Retry all
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={closeModal}>
                                {isCounting ? `Closing in (${Math.floor(seconds)})` : 'Close'}
                            </Button>
                            {hasQueued && (
                                <Button size="sm" disabled={isUploading || uploadCheck.isChecking || uploadCheck.isHashing} onClick={uploadCheck.check}>
                                    {isUploading ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : uploadCheck.isHashing || uploadCheck.isChecking ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            Checking files...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="mr-2 size-4" />
                                            Upload {stats.queued} {stats.queued === 1 ? 'file' : 'files'}
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {uploadCheck.review && (
                <DuplicateReviewDialog
                    items={uploadCheck.review.items}
                    cleanCount={uploadCheck.review.cleanCount}
                    folderName={targetFolderId ? findFolder(sectionsTree, targetFolderId)?.name : 'the top level'}
                    onConfirm={uploadCheck.confirm}
                    onCancel={uploadCheck.cancel}
                />
            )}
        </>
    );
}
