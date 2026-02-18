import type { Document } from '@reverie/shared';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface AiSummaryBannerProps {
    document: Document;
}

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
    const llmStatus = document.llm_status ?? 'skipped';
    const isProcessing = llmStatus === 'processing' || llmStatus === 'pending';
    const hasSummary = !!document.llm_summary;

    // Don't render if there's nothing to show
    if (!hasSummary && !isProcessing) return null;

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-20 mt-1"
            >
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                >
                    <div className="border-t border-border/20 pb-3 pt-2.5">
                        {isProcessing ? <ProcessingState /> : <p className="text-sm leading-relaxed text-foreground/85">{document.llm_summary}</p>}
                    </div>
                </motion.div>
            </motion.div>
        </>
    );
}
