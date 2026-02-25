import { useDocumentsStatus } from '@/lib/useDocumentStatus';
import { useProcessingProgress } from '@/lib/useProcessingProgress';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { AnimatePresence, motion } from 'motion/react';
import { Spinner } from './spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const DEFAULT_TOOLTIP = 'Processing files in the background. It may take a few minutes before your files are searchable.';

interface ProcessingIndicatorProps {
    documents: Document[];
    tooltipText?: string;
    variant?: 'badge' | 'banner';
    visible?: boolean;
    className?: string;
}

export function ProcessingIndicator({ documents, tooltipText = DEFAULT_TOOLTIP, variant = 'badge', visible = true, className }: ProcessingIndicatorProps) {
    const { processingDocumentIds, isProcessing } = useProcessingProgress(documents);

    useDocumentsStatus(processingDocumentIds);

    const shouldShow = visible && isProcessing;

    const progressContent = (
        <div
            className={cn(
                'flex items-center gap-2',
                variant === 'badge' && 'text-xs text-muted-foreground',
                variant === 'banner' && 'text-sm text-muted-foreground',
            )}
        >
            <Spinner className="size-4" />
        </div>
    );

    if (variant === 'badge') {
        return (
            <AnimatePresence>
                {shouldShow && (
                    <motion.div
                        key="processing-indicator"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className={cn('shrink-0', className)}
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="cursor-default">{progressContent}</div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={4}>
                                {tooltipText}
                            </TooltipContent>
                        </Tooltip>
                    </motion.div>
                )}
            </AnimatePresence>
        );
    }

    return (
        <AnimatePresence>
            {shouldShow && (
                <motion.div
                    key="processing-banner"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="shrink-0 overflow-hidden border-b border-border bg-muted/30 px-4 py-2"
                >
                    <div className="flex flex-row gap-1.5">
                        {progressContent}
                        <p className="text-sm text-muted-foreground">{tooltipText}</p>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
