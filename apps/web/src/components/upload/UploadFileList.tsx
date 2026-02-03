import { Button } from '@/components/ui/button';
import { useUpload } from '@/lib/upload';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { UploadFileItem } from './UploadFileItem';

interface UploadFileListProps {
    folderId?: string;
}

export function UploadFileList({ folderId }: UploadFileListProps) {
    const { files, isUploading, startUpload, removeFile, clearCompleted, clearFailed, retryFailed, retryFile, stats } = useUpload();

    if (files.length === 0) {
        return null;
    }

    const hasQueued = stats.queued > 0;
    const hasCompleted = stats.complete > 0;
    const hasFailed = stats.error > 0;
    const allComplete = files.length > 0 && stats.complete === files.length;

    return (
        <div className="mt-6 space-y-4">
            {/* Header with stats */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h3 className="font-medium">
                        {files.length} {files.length === 1 ? 'file' : 'files'}
                    </h3>

                    {/* Progress summary */}
                    {(stats.uploading > 0 || stats.processing > 0) && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            {stats.uploading > 0 && <span>Uploading {stats.uploading}</span>}
                            {stats.processing > 0 && <span>Processing {stats.processing}</span>}
                        </motion.div>
                    )}

                    {/* Failed count */}
                    {hasFailed && !isUploading && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 text-sm text-destructive">
                            <AlertCircle className="size-4" />
                            {stats.error} failed
                        </motion.div>
                    )}

                    {allComplete && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1 text-sm text-green-600"
                        >
                            <CheckCircle2 className="size-4" />
                            All complete!
                        </motion.div>
                    )}
                </div>

                <div className="flex items-center gap-2">
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
                                    // Automatically start upload after requeueing
                                    setTimeout(() => startUpload(folderId), 0);
                                }}
                            >
                                <RefreshCw className="mr-2 size-4" />
                                Retry all
                            </Button>
                        </>
                    )}

                    {hasQueued && (
                        <Button onClick={() => startUpload(folderId)} disabled={isUploading}>
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
            </div>

            {/* File list */}
            <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                    {files.map((file) => (
                        <UploadFileItem key={file.id} file={file} onRemove={removeFile} onRetry={retryFile} />
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
