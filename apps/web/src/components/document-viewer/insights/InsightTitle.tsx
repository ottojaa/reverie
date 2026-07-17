import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { ChevronDown, CircleAlert, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toInsightPhase } from './insight-state';

interface InsightTitleProps {
    document: Document;
    isOpen: boolean;
    onToggle: () => void;
}

function ShimmerText({ children }: { children: string }) {
    return (
        <span
            className="animate-shimmer bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-clip-text text-transparent"
            style={{ backgroundSize: '200% 100%' }}
        >
            {children}
        </span>
    );
}

/**
 * The toolbar title block: the filename heading (always — the AI title lives in
 * the panel) plus a subtitle that narrates processing, teases the AI summary,
 * or falls back to the file-type label. The whole block is the disclosure
 * control for the insight panel — a persistent chevron makes that obvious
 * without adding a separate button.
 */
export function InsightTitle({ document, isOpen, onToggle }: InsightTitleProps) {
    const phase = toInsightPhase(document);
    const fileConfig = getFileTypeConfig(document.mime_type);

    return (
        <motion.button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls="document-insight-panel"
            data-insight-trigger
            title={`${document.original_filename} — details`}
            /* max-w-xl mirrors the insight panel's width so the clickable block and the panel that drops from it read as one unit */
            className="group -mx-1.5 min-w-0 max-w-xl cursor-pointer rounded-md px-1.5 py-0.5 text-left outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
            <span className="min-w-0">
                {/* Heading with the disclosure chevron right after the text, not at the block's far edge */}
                <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm font-medium text-foreground">{document.original_filename}</span>
                    <ChevronDown
                        className={cn(
                            'size-3.5 shrink-0 text-muted-foreground/50 transition-[transform,color] duration-200 group-hover:text-muted-foreground',
                            isOpen && 'rotate-180 text-foreground',
                        )}
                    />
                </span>

                {/* Subtitle — narration / teaser / failure / file-type label.
                    Dimmed while the panel is open: the full summary is visible right below,
                    so the teaser shouldn't compete with it. */}
                <span className={cn('block transition-opacity duration-200', isOpen && 'opacity-50')}>
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                            key={phase.kind}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                            {phase.kind === 'reading' && (
                                <>
                                    <Sparkles className="size-3 shrink-0 text-primary/70" />
                                    <ShimmerText>Reading document…</ShimmerText>
                                </>
                            )}
                            {phase.kind === 'writing' && (
                                <>
                                    <Sparkles className="size-3 shrink-0 text-primary/70" />
                                    <ShimmerText>Writing summary…</ShimmerText>
                                </>
                            )}
                            {phase.kind === 'summary' && (
                                <>
                                    <Sparkles className="size-3 shrink-0 text-primary" />
                                    <span className="line-clamp-1 min-w-0">{phase.summary}</span>
                                </>
                            )}
                            {phase.kind === 'failed' && (
                                <>
                                    <CircleAlert className="size-3 shrink-0 text-destructive/80" />
                                    <span>Couldn&apos;t generate insights</span>
                                </>
                            )}
                            {phase.kind === 'idle' && <span>{fileConfig.label}</span>}
                        </motion.span>
                    </AnimatePresence>
                </span>
            </span>
        </motion.button>
    );
}
