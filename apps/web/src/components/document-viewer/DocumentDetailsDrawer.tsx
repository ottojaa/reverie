import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { FileTypeIcon, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { useOcrResult, useReprocessLlm, useRetryOcr } from '@/lib/api/documents';
import { formatDateTime, formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Calendar, Clock, FileType, Hash, ImageIcon, Layers, Loader2, ScanText, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';

interface DocumentDetailsDrawerProps {
    document: Document;
    isOpen: boolean;
    onClose: () => void;
}

function formatCategory(category: string): string {
    return category
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

interface DetailRowProps {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    delay?: number;
}

function DetailRow({ icon, label, value, delay = 0 }: DetailRowProps) {
    return (
        <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-start gap-3 py-2.5"
        >
            <span className="mt-0.5 text-muted-foreground/60">{icon}</span>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{label}</p>
                <div className="mt-0.5 text-sm text-foreground">{value}</div>
            </div>
        </motion.div>
    );
}

function StatusBadge({ status, onClick, disabled }: { status: string; onClick?: () => void; disabled?: boolean }) {
    const styles: Record<string, string> = {
        complete: 'bg-success/15 text-success',
        processing: 'bg-info/15 text-info',
        pending: 'bg-warning/15 text-warning',
        failed: 'bg-destructive/15 text-destructive',
        skipped: 'bg-muted text-muted-foreground',
    };

    const baseClasses = cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status] ?? 'bg-muted text-muted-foreground');

    if (onClick && !disabled) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={cn(baseClasses, 'cursor-pointer transition-opacity hover:opacity-80')}
                title="Click to reprocess"
            >
                {status}
            </button>
        );
    }

    return <span className={baseClasses}>{status}</span>;
}

function DrawerBody({ document }: { document: Document }) {
    const fileConfig = getFileTypeConfig(document.mime_type);
    const reprocessLlm = useReprocessLlm();
    const retryOcr = useRetryOcr();
    const ocrStatus = document.ocr_status ?? 'skipped';
    const canRunOcr = ocrStatus === 'failed' || ocrStatus === 'complete' || ocrStatus === 'skipped';
    const ocrResultQuery = useOcrResult(document.id, ocrStatus === 'complete');

    const llmStatus = document.llm_status ?? 'skipped';
    const canReprocessLlm = llmStatus === 'failed' || llmStatus === 'complete' || llmStatus === 'skipped';
    const baseDelay = 0.05;
    let rowIndex = 0;
    const nextDelay = () => baseDelay + 0.03 * rowIndex++;

    return (
        <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* File identity */}
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03, duration: 0.25 }}
                className="mb-5 flex items-center gap-3"
            >
                <div className={cn('rounded-lg p-2', fileConfig.bgColor)}>
                    <FileTypeIcon mimeType={document.mime_type} size="md" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={document.original_filename}>
                        {document.original_filename}
                    </p>
                    <p className="text-xs text-muted-foreground">{fileConfig.label}</p>
                </div>
            </motion.div>

            <div className="space-y-0.5 divide-y divide-border/30">
                <DetailRow icon={<FileType className="size-3.5" />} label="Type" value={document.mime_type} delay={nextDelay()} />

                <DetailRow icon={<Hash className="size-3.5" />} label="Size" value={formatFileSize(document.size_bytes)} delay={nextDelay()} />

                {document.width != null && document.height != null && (
                    <DetailRow
                        icon={<ImageIcon className="size-3.5" />}
                        label="Dimensions"
                        value={`${document.width} × ${document.height} px`}
                        delay={nextDelay()}
                    />
                )}

                {document.document_category && (
                    <DetailRow
                        icon={<Layers className="size-3.5" />}
                        label="Category"
                        value={
                            <span className="inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                {formatCategory(document.document_category)}
                            </span>
                        }
                        delay={nextDelay()}
                    />
                )}

                <DetailRow icon={<Calendar className="size-3.5" />} label="Uploaded" value={formatDateTime(document.created_at)} delay={nextDelay()} />

                <DetailRow icon={<Clock className="size-3.5" />} label="Last modified" value={formatDateTime(document.updated_at)} delay={nextDelay()} />

                {document.extracted_date && (
                    <DetailRow icon={<Calendar className="size-3.5" />} label="Document date" value={document.extracted_date} delay={nextDelay()} />
                )}
            </div>

            {/* Processing status */}
            <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: nextDelay(), duration: 0.25 }} className="mt-5">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Processing</p>
                <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">OCR</span>
                        <StatusBadge status={ocrStatus} {...(canRunOcr && { onClick: () => retryOcr.mutate(document.id) })} disabled={retryOcr.isPending} />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Thumbnail</span>
                        <StatusBadge status={document.thumbnail_status} />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">LLM</span>
                        <StatusBadge
                            status={llmStatus}
                            {...(canReprocessLlm && { onClick: () => reprocessLlm.mutate(document.id) })}
                            disabled={reprocessLlm.isPending}
                        />
                    </div>
                </div>
            </motion.div>

            {/* OCR Result */}
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: nextDelay(), duration: 0.3 }}
                className="mt-5 rounded-lg bg-muted/50 p-4"
            >
                <div className="mb-2 flex items-center gap-1.5">
                    <ScanText className="size-3.5 text-primary" />
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">OCR Result</p>
                </div>
                {(ocrStatus === 'pending' || ocrStatus === 'processing') && (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span>Generating OCR…</span>
                    </div>
                )}
                {ocrStatus === 'failed' && (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">OCR failed.</p>
                        <Button variant="outline" size="sm" onClick={() => retryOcr.mutate(document.id)} disabled={retryOcr.isPending}>
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
                {ocrStatus === 'skipped' && (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">OCR not run for this document.</p>
                        <Button variant="outline" size="sm" onClick={() => retryOcr.mutate(document.id)} disabled={retryOcr.isPending}>
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
                {ocrStatus === 'complete' && (
                    <>
                        {ocrResultQuery.isLoading && (
                            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                                <Loader2 className="size-4 animate-spin" />
                                <span>Loading result…</span>
                            </div>
                        )}
                        {ocrResultQuery.isError && <p className="text-sm text-destructive">Failed to load OCR result.</p>}
                        {ocrResultQuery.data && (
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2 text-[10px]">
                                    {ocrResultQuery.data.confidence_score != null && (
                                        <span className="rounded bg-muted px-1.5 py-0.5">Confidence: {ocrResultQuery.data.confidence_score}%</span>
                                    )}
                                    {ocrResultQuery.data.text_density != null && (
                                        <span className="rounded bg-muted px-1.5 py-0.5">Density: {ocrResultQuery.data.text_density.toFixed(1)}</span>
                                    )}
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5',
                                            ocrResultQuery.data.has_meaningful_text ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
                                        )}
                                    >
                                        {ocrResultQuery.data.has_meaningful_text ? 'Meaningful text' : 'No meaningful text'}
                                    </span>
                                </div>
                                {ocrResultQuery.data.raw_text ? (
                                    <pre className="max-h-48 overflow-auto rounded border border-border/50 bg-background/80 p-2.5 text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap wrap-break-word">
                                        {ocrResultQuery.data.raw_text}
                                    </pre>
                                ) : (
                                    <p className="text-xs text-muted-foreground italic">No text extracted.</p>
                                )}
                                {ocrResultQuery.data.metadata &&
                                    (Boolean(ocrResultQuery.data.metadata.companies?.length) ||
                                        Boolean(ocrResultQuery.data.metadata.dates?.length) ||
                                        Boolean(ocrResultQuery.data.metadata.values?.length)) && (
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
                                                    {ocrResultQuery.data.metadata.values.map((v) => `${v.currency} ${v.amount}`).join(', ')}
                                                </p>
                                            ) : null}
                                        </div>
                                    )}
                                {ocrResultQuery.data.processed_at && (
                                    <p className="text-[10px] text-muted-foreground/50">Processed {formatDateTime(ocrResultQuery.data.processed_at)}</p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </motion.div>

            {/* LLM Summary */}
            {document.llm_summary && (
                <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: nextDelay(), duration: 0.3 }}
                    className="mt-5 rounded-lg bg-muted/50 p-4"
                >
                    <div className="mb-2 flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-primary" />
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">AI Summary</p>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/90">{document.llm_summary}</p>
                    {document.llm_processed_at && (
                        <p className="mt-2 text-[10px] text-muted-foreground/50">Generated {formatDateTime(document.llm_processed_at)}</p>
                    )}
                </motion.div>
            )}
        </div>
    );
}

export function DocumentDetailsDrawer({ document, isOpen, onClose }: DocumentDetailsDrawerProps) {
    return (
        <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()} direction="right">
            <DrawerContent className="h-full max-w-[360px]">
                <DrawerHeader className="border-b border-border/50 px-5 py-4">
                    <div className="flex items-center justify-between">
                        <DrawerTitle className="text-sm font-semibold tracking-tight">Details</DrawerTitle>
                        <DrawerClose className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                            <X className="size-4" />
                        </DrawerClose>
                    </div>
                    <DrawerDescription className="sr-only">Document details and metadata</DrawerDescription>
                </DrawerHeader>
                <DrawerBody document={document} />
            </DrawerContent>
        </Drawer>
    );
}
