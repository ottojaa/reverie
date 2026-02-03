import { Button } from '@/components/ui/button';
import { useUpload } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { FileUp, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface UploadDropzoneProps {
    className?: string;
    disabled?: boolean;
}

export function UploadDropzone({ className, disabled }: UploadDropzoneProps) {
    const { addFiles, isUploading } = useUpload();

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length > 0) {
                addFiles(acceptedFiles);
            }
        },
        [addFiles],
    );

    const { getRootProps, getInputProps, isDragActive, isDragAccept, open } = useDropzone({
        onDrop,
        disabled: disabled || isUploading,
        noClick: true, // We'll use a button instead
        noKeyboard: false,
    });

    return (
        <div
            {...getRootProps()}
            className={cn(
                'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200',
                isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
                (disabled || isUploading) && 'pointer-events-none opacity-50',
                className,
            )}
        >
            <input {...getInputProps()} />

            <AnimatePresence mode="wait">
                {isDragActive ? (
                    <motion.div
                        key="drag-active"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex flex-col items-center"
                    >
                        <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 1, repeat: Infinity }} className="rounded-full bg-primary/10 p-4">
                            <FileUp className="size-10 text-primary" />
                        </motion.div>
                        <p className="mt-4 text-lg font-medium text-primary">{isDragAccept ? 'Drop files here' : 'Release to upload'}</p>
                    </motion.div>
                ) : (
                    <motion.div
                        key="drag-inactive"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center"
                    >
                        <div className="rounded-full bg-primary/10 p-4">
                            <Upload className="size-10 text-primary" />
                        </div>
                        <p className="mt-4 text-lg font-medium">Drag and drop files here</p>
                        <p className="mt-1 text-sm text-muted-foreground">or click the button below to select files</p>
                        <Button onClick={open} className="mt-6" disabled={disabled || isUploading}>
                            <Upload className="mr-2 size-4" />
                            Choose Files
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
