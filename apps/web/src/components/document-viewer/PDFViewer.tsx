import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { ViewerProps } from './viewer-registry';

// Configure the pdf.js worker — use CDN for reliable cross-build compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

export default function PDFViewer({ fileUrl }: ViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
        setNumPages(total);
        setIsLoaded(true);
    }, []);

    const onDocumentLoadError = useCallback((err: Error) => {
        setError(err.message || 'Failed to load PDF');
    }, []);

    const goToPage = useCallback(
        (page: number) => {
            setPageNumber(Math.max(1, Math.min(numPages, page)));
        },
        [numPages],
    );

    const zoomIn = useCallback(() => setScale((s) => Math.min(ZOOM_MAX, s + ZOOM_STEP)), []);
    const zoomOut = useCallback(() => setScale((s) => Math.max(ZOOM_MIN, s - ZOOM_STEP)), []);

    if (error) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="rounded-lg bg-card p-8 text-center">
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col">
            {/* PDF controls bar */}
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3 }}
                className="flex items-center justify-center gap-3 border-b border-border/30 bg-card/50 px-4 py-2 backdrop-blur-sm"
            >
                {/* Page navigation */}
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}>
                        <ChevronLeft className="size-4" />
                    </Button>
                    <span className="min-w-20 text-center text-xs text-muted-foreground">{isLoaded ? `${pageNumber} / ${numPages}` : '...'}</span>
                    <Button variant="ghost" size="icon-sm" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= numPages}>
                        <ChevronRight className="size-4" />
                    </Button>
                </div>

                <div className="h-4 w-px bg-border/50" />

                {/* Zoom controls */}
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={zoomOut} disabled={scale <= ZOOM_MIN}>
                        <Minus className="size-3.5" />
                    </Button>
                    <span className="min-w-12 text-center text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
                    <Button variant="ghost" size="icon-sm" onClick={zoomIn} disabled={scale >= ZOOM_MAX}>
                        <Plus className="size-3.5" />
                    </Button>
                </div>
            </motion.div>

            {/* PDF document area */}
            <div className={cn('flex flex-1 items-start justify-center overflow-auto p-6', !isLoaded && 'items-center')}>
                {!isLoaded && <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />}
                <Document
                    file={fileUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={null}
                    className={cn(!isLoaded && 'hidden')}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="shadow-2xl"
                    >
                        <Page pageNumber={pageNumber} scale={scale} renderTextLayer renderAnnotationLayer />
                    </motion.div>
                </Document>
            </div>
        </div>
    );
}
