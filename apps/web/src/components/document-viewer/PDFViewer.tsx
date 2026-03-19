import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    const [aspectRatio, setAspectRatio] = useState<number | null>(null);
    const [scale, setScale] = useState(1);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = containerRef.current;

        if (!el) return;

        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];

            if (entry) {
                const { width, height } = entry.contentRect;

                setContainerSize({ width, height });
            }
        });

        ro.observe(el);

        return () => ro.disconnect();
    }, []);

    const onDocumentLoadSuccess = useCallback(
        async (pdf: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number } }> }) => {
            setNumPages(pdf.numPages);

            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1 });

            setAspectRatio(viewport.width / viewport.height);
            setIsLoaded(true);
        },
        [],
    );

    const onDocumentLoadError = useCallback((err: Error) => {
        setError(err.message || 'Failed to load PDF');
    }, []);

    const zoomIn = useCallback(() => setScale((s) => Math.min(ZOOM_MAX, s + ZOOM_STEP)), []);
    const zoomOut = useCallback(() => setScale((s) => Math.max(ZOOM_MIN, s - ZOOM_STEP)), []);

    const pageWidth =
        containerSize.width && containerSize.height && aspectRatio
            ? (() => {
                  const fitByWidth = containerSize.width;
                  const fitByHeight = containerSize.height * aspectRatio;
                  const baseWidth = Math.min(fitByWidth, fitByHeight);

                  return baseWidth * scale;
              })()
            : undefined;

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
                className="flex items-center justify-center border-b border-border/30 py-2"
            >
                <div className="flex items-center gap-2 rounded-full border border-border/20 bg-card/60 px-3 py-1.5 backdrop-blur-sm">
                    <Button variant="ghost" size="icon-sm" onClick={zoomOut} disabled={scale <= ZOOM_MIN}>
                        <Minus className="size-3.5" />
                    </Button>
                    <span className="min-w-10 text-center text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
                    <Button variant="ghost" size="icon-sm" onClick={zoomIn} disabled={scale >= ZOOM_MAX}>
                        <Plus className="size-3.5" />
                    </Button>
                    {isLoaded && (
                        <span className="border-l border-border/30 pl-2 text-[11px] text-muted-foreground/40">
                            — {numPages} pp
                        </span>
                    )}
                </div>
            </motion.div>

            {/* PDF document area */}
            <div
                ref={containerRef}
                className={cn('flex flex-1 flex-col items-center overflow-auto p-6', !isLoaded && 'justify-center')}
            >
                {!isLoaded && <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />}
                <Document
                    file={fileUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={null}
                    className={cn('flex flex-col gap-4', !isLoaded && 'hidden')}
                >
                    {Array.from({ length: numPages }, (_, i) => (
                        <motion.div
                            key={i + 1}
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                            className="flex flex-col items-center gap-2"
                        >
                            <div className="shadow-2xl">
                                <Page pageNumber={i + 1} width={pageWidth} renderTextLayer renderAnnotationLayer />
                            </div>
                            <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">
                                {i + 1} / {numPages}
                            </span>
                        </motion.div>
                    ))}
                </Document>
            </div>
        </div>
    );
}
