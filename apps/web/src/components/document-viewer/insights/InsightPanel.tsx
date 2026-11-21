import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { useRemoveLabelMatch } from '@/lib/api/taught-labels';
import { useUser } from '@/lib/api/users';
import { formatDateTime, formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { addFilter, type Document } from '@reverie/shared';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles, Tag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OcrResultDialog } from '../OcrResultDialog';
import { formatCategory, isFallbackLlmMetadata, parseLlmMetadata } from './insight-state';
import { formatCaptureTime, toPhotoFacts, toVideoFacts } from './media-facts';
import { MetaCell, MicroLabel } from './MetaCell';
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

    const navigate = useNavigate();
    const removeMatch = useRemoveLabelMatch();
    const taughtTags = (document.tags ?? []).filter((tag) => tag.source === 'taught');

    // Jump to search filtered by the clicked chip. Topics have no `topic:` filter, so they map to tags.
    const searchBy = (key: 'category' | 'entity' | 'tag', value: string) => {
        onClose();
        navigate({ to: '/search', search: { q: addFilter('', key, value), sort_by: 'relevance', sort_order: 'desc', view: undefined } });
    };

    const entities = metadata?.entities.map((entity) => entity.canonical_name) ?? [];
    const topics = metadata?.topics ?? [];
    // Fallback records carry a truncated OCR preview as their "summary" — never present that as AI output
    const aiSummary = isFallbackLlmMetadata(document.llm_metadata) ? null : document.llm_summary;
    const hasAiContent = !!aiSummary || !!document.document_category || entities.length > 0 || topics.length > 0;
    const locationText = toLocationText(document.photo_metadata);
    // Camera and exposure for a photo, codec and frame rate for a video: only what the file carried
    const mediaFacts = [...toPhotoFacts(document.photo_metadata), ...toVideoFacts(document.video_metadata, document.duration_seconds)];

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
                        <div className="max-h-[min(72vh,36rem)] space-y-4 overflow-y-auto p-5">
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
                                        {document.document_category && (
                                            <Chip
                                                className="shrink-0"
                                                title="Search this category"
                                                onClick={() => searchBy('category', document.document_category!)}
                                            >
                                                {formatCategory(document.document_category)}
                                            </Chip>
                                        )}
                                    </div>
                                    {metadata?.appOrSource && (
                                        // The app or source the image comes from. It is also a tag, so the chip searches by tag.
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <MicroLabel>From</MicroLabel>
                                            <Chip
                                                className="min-w-0 max-w-full truncate"
                                                title="Search this app or source"
                                                onClick={() => searchBy('tag', metadata.appOrSource!)}
                                            >
                                                <span className="truncate">{metadata.appOrSource}</span>
                                            </Chip>
                                        </div>
                                    )}
                                    <p className="text-sm leading-relaxed text-foreground/90">{aiSummary}</p>
                                </Section>
                            )}

                            {/* Category still deserves a home when there's no summary block to host it */}
                            {!aiSummary && document.document_category && (
                                <Section delay={nextDelay()}>
                                    <Chip title="Search this category" onClick={() => searchBy('category', document.document_category!)}>
                                        {formatCategory(document.document_category)}
                                    </Chip>
                                </Section>
                            )}

                            {/* Mentions (specific names the document contains) and topics (what it's about) are different kinds of facts — separate sections */}
                            {entities.length > 0 && (
                                <Section delay={nextDelay()} className="space-y-1.5">
                                    <MicroLabel>Mentions</MicroLabel>
                                    <div className="flex flex-wrap gap-1">
                                        {entities.map((name) => (
                                            <Chip key={name} title="Search this mention" onClick={() => searchBy('entity', name)}>
                                                {name}
                                            </Chip>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {topics.length > 0 && (
                                <Section delay={nextDelay()} className="space-y-1.5">
                                    <MicroLabel>Topics</MicroLabel>
                                    <div className="flex flex-wrap gap-1">
                                        {topics.map((topic) => (
                                            <Chip key={topic} variant="secondary" title="Search this topic" onClick={() => searchBy('tag', topic)}>
                                                {topic}
                                            </Chip>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* Labels taught by example: dashed chips; × takes one off and keeps the label from coming back */}
                            {taughtTags.length > 0 && (
                                <Section delay={nextDelay()} className="space-y-1.5">
                                    <MicroLabel>Taught labels</MicroLabel>
                                    <div className="flex flex-wrap gap-1.5">
                                        {taughtTags.map((tag) => (
                                            <span key={tag.name} className="inline-flex items-center gap-0.5">
                                                <Chip variant="taught" title="Search this label" onClick={() => searchBy('tag', tag.name)}>
                                                    <Tag className="size-3 shrink-0" />
                                                    <span className="max-w-48 truncate">{tag.name}</span>
                                                </Chip>
                                                {tag.label_id && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        className="size-5 text-muted-foreground"
                                                        disabled={removeMatch.isPending}
                                                        aria-label={`Remove the label ${tag.name} from this document`}
                                                        title="Remove this label from this document (it won't come back)"
                                                        onClick={() => removeMatch.mutate({ id: tag.label_id!, documentId: document.id })}
                                                    >
                                                        <X className="size-3" />
                                                    </Button>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* File facts as a scannable label/value grid (the filename is the toolbar heading, so it's not repeated here) */}
                            <Section delay={nextDelay()} className={cn('grid grid-cols-2 gap-x-6 gap-y-2.5', hasAiContent && 'border-t border-border/40 pt-3')}>
                                <MetaCell label="Size" value={`${fileConfig.label} · ${formatFileSize(document.size_bytes)}`} title={document.mime_type} />
                                {/* A probed video shows its size as "Resolution" below, so the poster frame's size is not repeated */}
                                {document.width != null && document.height != null && !document.video_metadata && (
                                    <MetaCell label="Dimensions" value={`${document.width} × ${document.height} px`} />
                                )}
                                {document.extracted_date && <MetaCell label="Document date" value={document.extracted_date} />}
                                {document.photo_metadata?.taken_at && (
                                    <MetaCell
                                        label="Taken"
                                        value={formatCaptureTime(document.photo_metadata.taken_at, document.photo_metadata.taken_at_offset)}
                                    />
                                )}
                                {locationText && <MetaCell label="Location" value={locationText} />}
                                <MetaCell label="Uploaded" value={formatDateTime(document.created_at)} />
                                <MetaCell label="Modified" value={formatDateTime(document.updated_at)} />
                            </Section>

                            {mediaFacts.length > 0 && (
                                <Section delay={nextDelay()} className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-border/40 pt-3">
                                    {mediaFacts.map((fact) => (
                                        <MetaCell key={fact.label} label={fact.label} value={fact.value} />
                                    ))}
                                </Section>
                            )}

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
            {isAdmin && (
                <OcrResultDialog documentId={document.id} ocrStatus={document.ocr_status ?? 'skipped'} open={ocrDialogOpen} onOpenChange={setOcrDialogOpen} />
            )}
        </div>
    );
}
