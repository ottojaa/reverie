import { Button } from '@/components/ui/button';
import type { UploadFile } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { AlertCircle, Check, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, RefreshCw, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Spinner } from '../ui/spinner';

interface UploadFileItemProps {
    file: UploadFile;
    onRemove?: (fileId: string) => void;
    onRetry?: (fileId: string) => void;
    /** When true, root is a plain div (for use inside a parent that handles exit animation) */
    disableExitAnimation?: boolean;
}

/**
 * Get icon and color for a file based on MIME type
 */
function getFileIcon(mimeType: string): { icon: typeof File; color: string } {
    if (mimeType.startsWith('image/')) {
        return { icon: FileImage, color: 'text-blue-500' };
    }
    if (mimeType === 'application/pdf') {
        return { icon: FileText, color: 'text-red-500' };
    }
    if (mimeType.startsWith('video/')) {
        return { icon: FileVideo, color: 'text-purple-500' };
    }
    if (mimeType.startsWith('audio/')) {
        return { icon: FileAudio, color: 'text-green-500' };
    }
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
        return { icon: FileSpreadsheet, color: 'text-emerald-600' };
    }
    if (mimeType.includes('word') || mimeType.includes('document')) {
        return { icon: FileText, color: 'text-blue-600' };
    }
    if (mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json')) {
        return { icon: FileCode, color: 'text-gray-600' };
    }
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('tar')) {
        return { icon: FileArchive, color: 'text-yellow-600' };
    }
    return { icon: File, color: 'text-gray-400' };
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UploadFileItem({ file, onRemove, onRetry, disableExitAnimation }: UploadFileItemProps) {
    const { icon: FileIcon, color: iconColor } = getFileIcon(file.file.type);

    const progress =
        file.status === 'uploading' ? file.uploadProgress : file.status === 'processing' ? file.processingProgress : file.status === 'complete' ? 100 : 0;

    const canRemove = file.status === 'queued' || file.status === 'error';
    const canRetry = file.status === 'error';

    const isProcessing = file.status === 'processing';
    const isQueued = file.status === 'queued';
    const className = cn('relative overflow-hidden rounded-lg border bg-card p-4', isQueued && 'opacity-80');

    const content = (
        <>
            {/* Progress bar background – upload phase only */}
            {file.status === 'uploading' && (
                <motion.div
                    className="absolute inset-0 bg-primary/5"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                />
            )}
            {/* Processing: pulsing teal glow */}
            {isProcessing && (
                <motion.div
                    className="pointer-events-none absolute inset-0 rounded-lg"
                    animate={{
                        boxShadow: ['0 0 12px rgba(79, 209, 197, 0.12)', '0 0 24px rgba(79, 209, 197, 0.22)', '0 0 12px rgba(79, 209, 197, 0.12)'],
                    }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            <div className="relative flex items-center gap-4">
                {/* File icon */}
                <div className={cn('shrink-0', iconColor)}>
                    <FileIcon className="size-8" />
                </div>

                {/* File info */}
                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{file.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.file.size)}
                        {isQueued && ' • Queued'}
                        {file.status === 'uploading' && ` • Uploading ${progress}%`}
                        {file.status === 'processing' && ` • Processing ${progress}%`}
                        {file.status === 'error' && file.error && <span className="text-destructive"> • {file.error}</span>}
                    </p>
                </div>

                {/* Status indicator */}
                <div className="shrink-0">
                    {(file.status === 'uploading' || file.status === 'processing') && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: [0, 1.2, 1] }}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            className="p-1"
                        >
                            <Spinner className="size-5 text-primary" />
                        </motion.div>
                    )}

                    {file.status === 'complete' && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: [0, 1.2, 1] }}
                            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                            className="rounded-full bg-success p-1"
                        >
                            <Check className="size-4 text-white" />
                        </motion.div>
                    )}

                    {file.status === 'error' && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="rounded-full bg-destructive p-1">
                            <AlertCircle className="size-4 text-white" />
                        </motion.div>
                    )}
                </div>

                {/* Retry button */}
                {canRetry && onRetry && (
                    <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => onRetry(file.id)} title="Retry upload">
                        <RefreshCw className="size-4" />
                    </Button>
                )}

                {/* Remove button */}
                {canRemove && onRemove && (
                    <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => onRemove(file.id)} title="Remove file">
                        <X className="size-4" />
                    </Button>
                )}
            </div>
        </>
    );

    if (disableExitAnimation) {
        return <div className={className}>{content}</div>;
    }

    return (
        <motion.div layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20, height: 0 }} className={className}>
            {content}
        </motion.div>
    );
}
