import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { FileTypeIcon, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { useReprocessLlm, useRetryOcr } from '@/lib/api/documents';
import { formatDateTime, formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document, Entity, LlmMetadata } from '@reverie/shared';
import { Brain, Calendar, Clock, ExternalLink, FileType, Hash, ImageIcon, Layers, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { AiSummaryBanner } from './AiSummaryBanner';
import { OcrResultDialog } from './OcrResultDialog';

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
        waiting: 'bg-muted text-muted-foreground',
        failed: 'bg-destructive/15 text-destructive',
        skipped: 'bg-muted text-muted-foreground',
    };

    const baseClasses = cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', styles[status] ?? 'bg-muted text-muted-foreground');

    if (onClick && !disabled) {
        return (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClick}
                className={cn(baseClasses, 'h-auto min-h-0 cursor-pointer border-0 px-2 py-0.5 shadow-none transition-opacity hover:opacity-80 hover:bg-transparent')}
                title="Click to reprocess"
            >
                {status}
            </Button>
        );
    }

    return <span className={baseClasses}>{status}</span>;
}

function Chip({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
    return (
        <span
            className={cn(
                'inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                variant === 'primary' ? 'bg-primary/10 text-primary' : 'border border-border/50 bg-secondary text-secondary-foreground',
            )}
        >
            {children}
        </span>
    );
}

/**
 * Safely parse llm_metadata from the loosely-typed API field into the domain LlmMetadata shape.
 * The actual data uses camelCase (matches backend EnhancedMetadata).
 */
function parseLlmMetadata(raw: Record<string, unknown> | null | undefined): LlmMetadata | null {
    if (!raw || typeof raw !== 'object') return null;

    // Skip if this is a "skipped" metadata record
    if (raw.skipped === true) return null;

    const parseStringArray = (val: unknown): string[] => (Array.isArray(val) ? val.filter((s): s is string => typeof s === 'string') : []);

    // keyEntities is Entity[]
    const rawEntities = typeof raw.entities === 'object' && raw.entities != null ? (raw.entities as Entity[]) : [];

    const result: LlmMetadata = {
        type: raw.type === 'vision_describe' ? 'vision_describe' : 'text_summary',
        entities: rawEntities.map((entity) => ({
            type: entity.type,
            canonical_name: entity.canonical_name,
            raw_text: entity.raw_text,
            confidence: entity.confidence,
        })),
        topics: parseStringArray(raw.topics),
    };

    if (typeof raw.title === 'string') result.title = raw.title;

    if (typeof raw.language === 'string') result.language = raw.language;

    if (typeof raw.documentType === 'string') result.documentType = raw.documentType;

    if (typeof raw.extractedDate === 'string') result.extractedDate = raw.extractedDate;

    if (Array.isArray(raw.extractedDates)) {
        result.extractedDates = raw.extractedDates
            .filter(
                (d): d is { date: string; context: string } | string =>
                    (typeof d === 'object' && d != null && typeof (d as Record<string, unknown>).date === 'string') || typeof d === 'string',
            )
            .map((d) => (typeof d === 'string' ? { date: d, context: '' } : d));
    }

    if (Array.isArray(raw.keyValues)) {
        result.keyValues = raw.keyValues.filter(
            (kv): kv is { label: string; value: string } =>
                typeof kv === 'object' &&
                kv != null &&
                typeof (kv as Record<string, unknown>).label === 'string' &&
                typeof (kv as Record<string, unknown>).value === 'string',
        );
    }

    if (Array.isArray(raw.tableData)) {
        result.tableData = raw.tableData.filter(
            (row): row is { item: string; columns: Record<string, string> } =>
                typeof row === 'object' && row != null && typeof (row as Record<string, unknown>).item === 'string',
        );
    }

    return result;
}

/** Flatten keyEntities into a single string array for display */
function flattenEntities(entities: LlmMetadata['entities']): string[] {
    return entities.map((entity) => entity.canonical_name);
}

function LlmMetadataSection({ document, metadata, delay }: { document: Document; metadata: LlmMetadata; delay: number }) {
    const entities = flattenEntities(metadata.entities);
    const hasEntities = entities.length > 0;
    const hasTopics = metadata.topics.length > 0;
    const hasKeyValues = metadata.keyValues && metadata.keyValues.length > 0;
    const hasDates = metadata.extractedDates && metadata.extractedDates.length > 0;
    const hasAnything = metadata.title || metadata.documentType || hasEntities || hasTopics || hasKeyValues || hasDates;

    if (!hasAnything) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.3 }}
            className="mt-5 space-y-3 rounded-lg bg-muted/40 p-4"
        >
            <div className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">AI Insights</p>
            </div>

            {/* Title */}
            {metadata.title && <p className="text-sm font-medium text-foreground">{metadata.title}</p>}

            <AiSummaryBanner document={document} />

            {/* Document type + key entities */}
            {(metadata.documentType || hasEntities) && (
                <div className="space-y-1.5">
                    {metadata.documentType && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                            <Brain className="size-2.5" />
                            {formatCategory(metadata.documentType)}
                        </span>
                    )}
                    {hasEntities && (
                        <div className="flex flex-wrap gap-1">
                            {entities.map((entity) => (
                                <Chip key={entity} variant="primary">
                                    {entity}
                                </Chip>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Topics */}
            {hasTopics && (
                <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Topics</p>
                    <div className="flex flex-wrap gap-1">
                        {metadata.topics.map((topic) => (
                            <Chip key={topic} variant="secondary">
                                {topic}
                            </Chip>
                        ))}
                    </div>
                </div>
            )}
        </motion.div>
    );
}

function DrawerBody({ document }: { document: Document }) {
    const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
    const fileConfig = getFileTypeConfig(document.mime_type);
    const reprocessLlm = useReprocessLlm();
    const retryOcr = useRetryOcr();
    const ocrStatus = document.ocr_status ?? 'skipped';
    const canRunOcr = ocrStatus === 'failed' || ocrStatus === 'complete' || ocrStatus === 'skipped';

    const rawLlmStatus = document.llm_status ?? 'skipped';
    // If LLM is "skipped" but OCR is still running, the LLM is just waiting for OCR to finish
    const ocrStillRunning = ocrStatus === 'pending' || ocrStatus === 'processing';
    const llmDisplayStatus = rawLlmStatus === 'skipped' && ocrStillRunning ? 'waiting' : rawLlmStatus;
    const canReprocessLlm = rawLlmStatus === 'failed' || rawLlmStatus === 'complete' || rawLlmStatus === 'skipped';
    const baseDelay = 0.05;
    let rowIndex = 0;
    const nextDelay = () => baseDelay + 0.03 * rowIndex++;

    const llmMetadata = parseLlmMetadata(document.llm_metadata);

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

            {/* File metadata */}
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

            {/* LLM Metadata */}
            {llmMetadata && <LlmMetadataSection document={document} metadata={llmMetadata} delay={nextDelay()} />}

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
                            status={llmDisplayStatus}
                            {...(canReprocessLlm && !ocrStillRunning && { onClick: () => reprocessLlm.mutate(document.id) })}
                            disabled={reprocessLlm.isPending}
                        />
                    </div>
                </div>

                {/* OCR Result link */}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOcrDialogOpen(true)}
                    className="mt-3 h-auto gap-1 px-0 py-0 text-[11px] text-muted-foreground hover:text-foreground"
                >
                    <ExternalLink className="size-3" />
                    View OCR Result
                </Button>
            </motion.div>

            <OcrResultDialog documentId={document.id} ocrStatus={ocrStatus} open={ocrDialogOpen} onOpenChange={setOcrDialogOpen} />
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
                        <DrawerClose asChild>
                            <Button variant="ghost" size="icon" className="text-muted-foreground">
                                <X className="size-4" />
                            </Button>
                        </DrawerClose>
                    </div>
                    <DrawerDescription className="sr-only">Document details and metadata</DrawerDescription>
                </DrawerHeader>
                <DrawerBody document={document} />
            </DrawerContent>
        </Drawer>
    );
}
