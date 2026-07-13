import { FileTypeIcon } from '@/components/ui/FileTypeIcon';
import { Button } from '@/components/ui/button';
import { buildDownloadUrl } from '@/lib/commonhelpers';
import { Download } from 'lucide-react';
import { motion } from 'motion/react';
import type { ViewerProps } from './viewer-registry';

export default function FallbackViewer({ document, fileUrl }: ViewerProps) {
    return (
        <div className="flex h-full w-full items-center justify-center">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center gap-6 rounded-xl bg-card p-10 text-center shadow-lg"
            >
                <div className="rounded-2xl bg-muted p-5">
                    <FileTypeIcon mimeType={document.mime_type} size="xl" />
                </div>

                <div>
                    <p className="text-sm font-medium text-foreground">{document.original_filename}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Preview not available for this file type</p>
                </div>

                <Button variant="secondary" asChild>
                    <a href={buildDownloadUrl(fileUrl, document.original_filename)} download={document.original_filename} rel="noopener noreferrer">
                        <Download className="size-4" />
                        Download file
                    </a>
                </Button>
            </motion.div>
        </div>
    );
}
