import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { memo } from 'react';

import { DocumentInfoFooter } from './DocumentInfoFooter';
import { DocumentThumbnail } from './DocumentThumbnail';
import { PulseOverlay } from './PulseOverlay';

interface DocumentCardVisualProps {
    document: Document;
    isSelected: boolean;
    isDragging: boolean;
    shouldPulse?: boolean;
    onPulseComplete?: () => void;
    className?: string;
}

export const DocumentCardVisual = memo(function DocumentCardVisual({
    document,
    isSelected,
    isDragging,
    shouldPulse,
    onPulseComplete,
    className,
}: DocumentCardVisualProps) {
    return (
        <div className="relative">
            <div
                className={cn(
                    'group relative overflow-hidden rounded-md bg-card transition-all duration-200',
                    'border border-border/50 shadow-md hover:shadow-lg',
                    'dark:border-border dark:shadow-none dark:hover:shadow-none',
                    'hover:scale-[1.02] hover:-translate-y-0.5',
                    isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background dark:ring-offset-background',
                    isDragging && 'cursor-grabbing scale-[0.98] opacity-50 !hover:scale-[0.98]',
                    className,
                )}
            >
                {isSelected && (
                    <div className="z-10 pointer-events-none absolute inset-0 rounded-md bg-primary/12 dark:bg-primary/15" aria-hidden />
                )}

                <DocumentThumbnail document={document} />
                <DocumentInfoFooter document={document} />
            </div>

            {shouldPulse && <PulseOverlay onComplete={onPulseComplete} />}
        </div>
    );
});
