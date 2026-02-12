import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

interface AiSummaryBannerProps {
    document: Document;
}

const shimmerKeyframes = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}
`;

function ProcessingState() {
    return (
        <div className="flex items-center gap-2.5">
            <Loader2 className="size-3.5 animate-spin text-primary/70" />
            <div className="flex-1">
                <div
                    className="h-3 w-3/4 rounded-sm bg-linear-to-r from-muted via-muted-foreground/10 to-muted"
                    style={{
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 2s ease-in-out infinite',
                    }}
                />
                <div
                    className="mt-1.5 h-3 w-1/2 rounded-sm bg-linear-to-r from-muted via-muted-foreground/10 to-muted"
                    style={{
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 2s ease-in-out infinite',
                        animationDelay: '0.3s',
                    }}
                />
            </div>
        </div>
    );
}

export function AiSummaryBanner({ document }: AiSummaryBannerProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const llmStatus = document.llm_status ?? 'skipped';
    const isProcessing = llmStatus === 'processing' || llmStatus === 'pending';
    const hasSummary = !!document.llm_summary;

    // Don't render if there's nothing to show
    if (!hasSummary && !isProcessing) return null;

    return (
        <>
            <style>{shimmerKeyframes}</style>
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-20 mx-4 mt-1 md:mx-6"
            >
                <div className="overflow-hidden rounded-xl border border-border/30 bg-card/80 shadow-sm backdrop-blur-lg">
                    {/* Header — always visible */}
                    <button
                        type="button"
                        onClick={() => setIsExpanded((v) => !v)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40"
                    >
                        <Sparkles className="size-3.5 shrink-0 text-primary" />
                        <span className="flex-1 text-xs font-medium tracking-wide text-muted-foreground">
                            {isProcessing ? 'Generating insights…' : 'AI Summary'}
                        </span>
                        <ChevronDown
                            className={cn(
                                'size-3.5 text-muted-foreground/60 transition-transform duration-200',
                                isExpanded && 'rotate-180',
                            )}
                        />
                    </button>

                    {/* Body — collapsible */}
                    <AnimatePresence initial={false}>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                className="overflow-hidden"
                            >
                                <div className="border-t border-border/20 px-4 pb-3 pt-2.5">
                                    {isProcessing ? (
                                        <ProcessingState />
                                    ) : (
                                        <p className="text-sm leading-relaxed text-foreground/85">
                                            {document.llm_summary}
                                        </p>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </>
    );
}
