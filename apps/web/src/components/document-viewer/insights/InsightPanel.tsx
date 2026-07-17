import { Chip } from '@/components/ui/chip';
import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { useUser } from '@/lib/api/users';
import { formatDateTime, formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OcrResultDialog } from '../OcrResultDialog';
import { formatCategory, isFallbackLlmMetadata, parseLlmMetadata } from './insight-state';
import { ProcessingFooter } from './ProcessingFooter';

const EASE = [0.22, 1, 0.36, 1] as const;

interface InsightPanelProps {
    document: Document;
    isOpen: boolean;
    onClose: () => void;
}

function Section({ delay, className, children }: { delay: number; className?: string; children: React.ReactNode }) {
    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25, ease: EASE }} className={className}>
            {children}
        </motion.div>
    );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</p>;
}

function MetaCell({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div className="min-w-0">
            <MicroLabel>{label}</MicroLabel>
            <p className="mt-0.5 truncate text-xs text-foreground/80" title={title ?? value}>
                {value}
            </p>
        </div>
    );
}

function toLocationText(photo: Document['photo_metadata']): string | null {
    if (!photo) return null;

    const place = [photo.city, photo.country].filter(Boolean).join(', ');

    if (place) return place;

    if (photo.latitude != null && photo.longitude != null) return `${photo.latitude.toFixed(3)}°, ${photo.longitude.toFixed(3)}°`;

    return null;
}

/**
 * The single home for document details: AI summary, tags, condensed file
 * metadata, and processing status. A glass overlay anchored below the toolbar —
 * it never shifts the document layout (dive-transition safe, z-40 < dive's z-50).
 */
export function InsightPanel({ document, isOpen, onClose }: InsightPanelProps) {
    const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const metadata = useMemo(() => parseLlmMetadata(document.llm_metadata), [document.llm_metadata]);
    const fileConfig = getFileTypeConfig(document.mime_type);
    // Processing internals (extracted text, re-runs, pipeline status) are admin tooling
    const { data: user } = useUser();
    const isAdmin = user?.role === 'admin';

    const entities = metadata?.entities.map((entity) => entity.canonical_name) ?? [];
    const topics = metadata?.topics ?? [];
    // Fallback records carry a truncated OCR preview as their "summary" — never present that as AI output
    const aiSummary = isFallbackLlmMetadata(document.llm_metadata) ? null : document.llm_summary;
    const hasAiContent = !!aiSummary || !!document.document_category || entities.length > 0 || topics.length > 0;
    const locationText = toLocationText(document.photo_metadata);

    // Close on Escape / click outside (but never underneath the OCR dialog,
    // the toolbar triggers, or portaled menu/dialog content)
    useEffect(() => {
        if (!isOpen || ocrDialogOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !e.defaultPrevented) onClose();
        }

        function handlePointerDown(e: PointerEvent) {
            const target = e.target;

            if (!(target instanceof HTMLElement)) return;

            if (panelRef.current?.contains(target)) return;

            if (target.closest('[data-insight-trigger],[role="menu"],[role="dialog"]')) return;

            onClose();
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('pointerdown', handlePointerDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [isOpen, ocrDialogOpen, onClose]);

    let sectionIndex = 0;
    const nextDelay = () => 0.06 + 0.04 * sectionIndex++;

    return (
        <div id="document-insight-panel" className="pointer-events-none absolute inset-x-0 top-14 z-40 px-4 md:px-6">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="insight-panel"
                        ref={panelRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        // ml-[34px] = back button 32px + gap 8px − title-block pad 6px: left-aligns the card with the title block it drops from
                        className="pointer-events-auto ml-[34px] max-w-xl overflow-hidden rounded-xl border border-border/50 bg-background/80 shadow-xl backdrop-blur-xl"
                    >
                        <div className="max-h-[min(60vh,30rem)] space-y-4 overflow-y-auto p-5">
                            {/* AI summary, headed by the AI title with the category chip beside it */}
                            {aiSummary && (
                                <Section delay={nextDelay()} className="space-y-1.5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <Sparkles className="size-3 shrink-0 text-primary" />
                                            {metadata?.title ? (
                                                <p className="truncate text-sm font-medium text-foreground" title={metadata.title}>
                                                    {metadata.title}
                                                </p>
                                            ) : (
                                                <MicroLabel>AI summary</MicroLabel>
                                            )}
                                        </div>
                                        {document.document_category && <Chip className="shrink-0">{formatCategory(document.document_category)}</Chip>}
                                    </div>
                                    <p className="text-sm leading-relaxed text-foreground/90">{aiSummary}</p>
                                </Section>
                            )}

                            {/* Category still deserves a home when there's no summary block to host it */}
                            {!aiSummary && document.document_category && (
                                <Section delay={nextDelay()}>
                                    <Chip>{formatCategory(document.document_category)}</Chip>
                                </Section>
                            )}

                            {/* One topics cloud — entities (primary chips) and topics (secondary chips) drive the same thing */}
                            {(entities.length > 0 || topics.length > 0) && (
                                <Section delay={nextDelay()} className="space-y-1.5">
                                    <MicroLabel>Topics</MicroLabel>
                                    <div className="flex flex-wrap gap-1">
                                        {entities.map((name) => (
                                            <Chip key={`entity-${name}`}>{name}</Chip>
                                        ))}
                                        {topics.map((topic) => (
                                            <Chip key={`topic-${topic}`} variant="secondary">
                                                {topic}
                                            </Chip>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* File facts as a scannable label/value grid (the filename is the toolbar heading, so it's not repeated here) */}
                            <Section delay={nextDelay()} className={cn('grid grid-cols-2 gap-x-6 gap-y-2.5', hasAiContent && 'border-t border-border/40 pt-3')}>
                                <MetaCell label="Size" value={`${fileConfig.label} · ${formatFileSize(document.size_bytes)}`} title={document.mime_type} />
                                {document.width != null && document.height != null && (
                                    <MetaCell label="Dimensions" value={`${document.width} × ${document.height} px`} />
                                )}
                                {document.extracted_date && <MetaCell label="Document date" value={document.extracted_date} />}
                                {document.photo_metadata?.taken_at && <MetaCell label="Taken" value={formatDateTime(document.photo_metadata.taken_at)} />}
                                {locationText && <MetaCell label="Location" value={locationText} />}
                                <MetaCell label="Uploaded" value={formatDateTime(document.created_at)} />
                                <MetaCell label="Modified" value={formatDateTime(document.updated_at)} />
                            </Section>

                            {/* Processing status + actions — admin tooling only */}
                            {isAdmin && (
                                <Section delay={nextDelay()} className="border-t border-border/40 pt-3">
                                    <ProcessingFooter document={document} onViewExtractedText={() => setOcrDialogOpen(true)} />
                                </Section>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Mounted outside AnimatePresence so an open dialog survives panel close; admin-only like its trigger */}
            {isAdmin && <OcrResultDialog documentId={document.id} ocrStatus={document.ocr_status ?? 'skipped'} open={ocrDialogOpen} onOpenChange={setOcrDialogOpen} />}
        </div>
    );
}
