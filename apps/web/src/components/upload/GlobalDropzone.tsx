import { useUpload } from '@/lib/upload';
import { FileUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface GlobalDropzoneProps {
    children: ReactNode;
}

export function GlobalDropzone({ children }: GlobalDropzoneProps) {
    const { addFiles, isUploading } = useUpload();

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length > 0) {
                addFiles(acceptedFiles);
            }
        },
        [addFiles],
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        disabled: isUploading,
        noClick: true,
        noKeyboard: true,
    });

    return (
        <div {...getRootProps()} className="relative flex flex-1 flex-col overflow-hidden">
            <input {...getInputProps()} />

            <AnimatePresence>
                {isDragActive && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 z-40 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10"
                    >
                        <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 1, repeat: Infinity }} className="rounded-full bg-primary/20 p-6">
                            <FileUp className="size-14 text-primary" />
                        </motion.div>
                        <p className="mt-6 text-xl font-medium text-primary">Drop files here to upload</p>
                        <p className="mt-1 text-sm text-muted-foreground">Release to add to upload queue</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {children}
        </div>
    );
}
