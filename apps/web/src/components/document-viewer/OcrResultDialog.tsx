import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useOcrResult, useRetryOcr } from '@/lib/api/documents';
import { formatDateTime } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { Loader2, ScanText } from 'lucide-react';

interface OcrResultDialogProps {
    documentId: string;
    ocrStatus: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium', className)}>
            {children}
        </span>
    );
}

export function OcrResultDialog({ documentId, ocrStatus, open, onOpenChange }: OcrResultDialogProps) {
    const ocrResultQuery = useOcrResult(documentId, ocrStatus === 'complete' && open);
    const retryOcr = useRetryOcr();

    const canRetry = ocrStatus === 'failed' || ocrStatus === 'complete' || ocrStatus === 'skipped';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <ScanText className="size-4 text-primary" />
                        <DialogTitle className="text-base">OCR Result</DialogTitle>
                    </div>
                    <DialogDescription>Raw text extraction and metadata from optical character recognition.</DialogDescription>
                </DialogHeader>

                <div className="flex-1 space-y-4 overflow-y-auto">
                    {/* Processing / pending */}
                    {(ocrStatus === 'pending' || ocrStatus === 'processing') && (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>OCR is {ocrStatus}…</span>
                        </div>
                    )}

                    {/* Failed */}
                    {ocrStatus === 'failed' && (
                        <div className="space-y-3 py-4">
                            <p className="text-sm text-muted-foreground">OCR processing failed.</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => retryOcr.mutate(documentId)}
                                disabled={retryOcr.isPending}
                            >
                                {retryOcr.isPending ? (
                                    <>
                                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                        Running…
                                    </>
                                ) : (
                                    'Retry OCR'
                                )}
                            </Button>
                        </div>
                    )}

                    {/* Skipped */}
                    {ocrStatus === 'skipped' && (
                        <div className="space-y-3 py-4">
                            <p className="text-sm text-muted-foreground">OCR was not run for this document.</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => retryOcr.mutate(documentId)}
                                disabled={retryOcr.isPending}
                            >
                                {retryOcr.isPending ? (
                                    <>
                                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                        Running…
                                    </>
                                ) : (
                                    'Run OCR'
                                )}
                            </Button>
                        </div>
                    )}

                    {/* Complete — loading result */}
                    {ocrStatus === 'complete' && ocrResultQuery.isLoading && (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>Loading result…</span>
                        </div>
                    )}

                    {/* Complete — error loading */}
                    {ocrStatus === 'complete' && ocrResultQuery.isError && (
                        <p className="py-4 text-sm text-destructive">Failed to load OCR result.</p>
                    )}

                    {/* Complete — data */}
                    {ocrStatus === 'complete' && ocrResultQuery.data && (
                        <>
                            {/* Stats badges */}
                            <div className="flex flex-wrap gap-2">
                                {ocrResultQuery.data.confidence_score != null && (
                                    <Badge className="bg-muted text-muted-foreground">
                                        Confidence: {ocrResultQuery.data.confidence_score}%
                                    </Badge>
                                )}
                                {ocrResultQuery.data.text_density != null && (
                                    <Badge className="bg-muted text-muted-foreground">
                                        Density: {ocrResultQuery.data.text_density.toFixed(1)}
                                    </Badge>
                                )}
                                <Badge
                                    className={cn(
                                        ocrResultQuery.data.has_meaningful_text
                                            ? 'bg-success/15 text-success'
                                            : 'bg-muted text-muted-foreground',
                                    )}
                                >
                                    {ocrResultQuery.data.has_meaningful_text ? 'Meaningful text' : 'No meaningful text'}
                                </Badge>
                            </div>

                            {/* Raw text */}
                            {ocrResultQuery.data.raw_text ? (
                                <pre className="max-h-72 overflow-auto rounded-lg border border-border/50 bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap wrap-break-word">
                                    {ocrResultQuery.data.raw_text}
                                </pre>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">No text extracted.</p>
                            )}

                            {/* Extracted metadata */}
                            {ocrResultQuery.data.metadata &&
                                (Boolean(ocrResultQuery.data.metadata.companies?.length) ||
                                    Boolean(ocrResultQuery.data.metadata.dates?.length) ||
                                    Boolean(ocrResultQuery.data.metadata.values?.length)) && (
                                    <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                                            Extracted Metadata
                                        </p>
                                        <div className="space-y-1.5 text-xs">
                                            {ocrResultQuery.data.metadata.companies?.length ? (
                                                <p>
                                                    <span className="text-muted-foreground">Companies: </span>
                                                    {ocrResultQuery.data.metadata.companies.join(', ')}
                                                </p>
                                            ) : null}
                                            {ocrResultQuery.data.metadata.dates?.length ? (
                                                <p>
                                                    <span className="text-muted-foreground">Dates: </span>
                                                    {ocrResultQuery.data.metadata.dates.join(', ')}
                                                </p>
                                            ) : null}
                                            {ocrResultQuery.data.metadata.values?.length ? (
                                                <p>
                                                    <span className="text-muted-foreground">Values: </span>
                                                    {ocrResultQuery.data.metadata.values
                                                        .map((v) => `${v.currency} ${v.amount}`)
                                                        .join(', ')}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                )}

                            {/* Timestamp + retry */}
                            <div className="flex items-center justify-between">
                                {ocrResultQuery.data.processed_at && (
                                    <p className="text-[10px] text-muted-foreground/50">
                                        Processed {formatDateTime(ocrResultQuery.data.processed_at)}
                                    </p>
                                )}
                                {canRetry && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => retryOcr.mutate(documentId)}
                                        disabled={retryOcr.isPending}
                                        className="text-xs text-muted-foreground"
                                    >
                                        {retryOcr.isPending ? (
                                            <>
                                                <Loader2 className="mr-1.5 size-3 animate-spin" />
                                                Running…
                                            </>
                                        ) : (
                                            'Re-run OCR'
                                        )}
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
