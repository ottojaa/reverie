import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUpload } from '@/lib/upload';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { UploadFileItem } from './UploadFileItem';

function useOverallProgress() {
    const { files } = useUpload();
    return useMemo(() => {
        if (files.length === 0) return { percent: 0, completedCount: 0, total: 0 };

        let sum = 0;
        let completedCount = 0;

        for (const f of files) {
            if (f.status === 'complete') {
                sum += 100;
                completedCount += 1;
            } else if (f.status === 'uploading') {
                sum += f.uploadProgress ?? 0;
            } else if (f.status === 'processing') {
                sum += f.processingProgress ?? 0;
            }
            // queued, error: add 0
        }
        const percent = Math.round((sum / (files.length * 100)) * 100);
        return { percent, completedCount, total: files.length };
    }, [files]);
}

export function UploadModal() {
    const { files, isModalOpen, closeModal, startUpload, removeFile, clearCompleted, clearFailed, retryFailed, retryFile, stats, isUploading } = useUpload();

    const { percent, completedCount, total } = useOverallProgress();

    const hasQueued = stats.queued > 0;
    const hasCompleted = stats.complete > 0;
    const hasFailed = stats.error > 0;
    const allComplete = total > 0 && stats.complete === total;

    const uploadStarted = stats.uploading > 0 || stats.processing > 0 || stats.complete > 0;

    if (files.length === 0) {
        return null;
    }

    return (
        <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent
                showCloseButton={true}
                className="flex max-h-[85vh] w-full max-w-lg flex-col max-md:h-full max-md:max-h-none max-md:rounded-none sm:max-w-lg md:max-w-xl"
            >
                <DialogHeader>
                    <DialogTitle>Uploading</DialogTitle>
                </DialogHeader>

                {/* Linear progress bar (Motion) – only after upload has started */}
                <AnimatePresence initial={false}>
                    {uploadStarted && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-2 overflow-hidden"
                        >
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <motion.div
                                    className="h-full rounded-full bg-primary"
                                    initial={false}
                                    animate={{ width: `${percent}%` }}
                                    transition={{ duration: 0.3, ease: 'easeOut' }}
                                />
                            </div>
                            <p className="text-center text-sm text-muted-foreground">
                                {percent}% · {completedCount} of {total} files
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* File list – margin on wrapper, exit animates height + margin so gap collapses cleanly */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <AnimatePresence initial={false}>
                        {files.map((file) => (
                            <motion.div
                                key={file.id}
                                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                                animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                                className="overflow-hidden"
                            >
                                <UploadFileItem file={file} onRemove={removeFile} onRetry={retryFile} disableExitAnimation />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {/* Status / actions */}
                <div className="flex flex-wrap items-center gap-2">
                    {(stats.uploading > 0 || stats.processing > 0) && (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            {stats.uploading > 0 && 'Uploading'}
                            {stats.uploading > 0 && stats.processing > 0 && '·'}
                            {stats.processing > 0 && 'Processing'}
                        </span>
                    )}
                    {allComplete && (
                        <motion.span
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1.5 text-sm text-green-600"
                        >
                            <CheckCircle2 className="size-4" />
                            All complete
                        </motion.span>
                    )}
                    {hasFailed && !isUploading && (
                        <span className="flex items-center gap-1.5 text-sm text-destructive">
                            <AlertCircle className="size-4" />
                            {stats.error} failed
                        </span>
                    )}
                </div>

                <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
                    <div className="flex gap-2">
                        {hasCompleted && (
                            <Button variant="ghost" size="sm" onClick={clearCompleted}>
                                Clear completed
                            </Button>
                        )}
                        {hasFailed && !isUploading && (
                            <>
                                <Button variant="ghost" size="sm" onClick={clearFailed}>
                                    Clear failed
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        retryFailed();
                                        setTimeout(() => startUpload(), 0);
                                    }}
                                >
                                    <RefreshCw className="mr-2 size-4" />
                                    Retry all
                                </Button>
                            </>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={closeModal}>
                            Minimize
                        </Button>
                        {hasQueued && (
                            <Button size="sm" onClick={() => startUpload()} disabled={isUploading}>
                                {isUploading ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        Uploading...
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
    );
}
