import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { FacetItem, FilterKey } from '@reverie/shared';
import { ChevronDown, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { FacetListPanel } from './FacetListPanel';
import { formatPillLabel, type FilterDimension } from './filter-defs';

export const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

interface FilterPillProps {
    dimension: FilterDimension;
    activeValues: string[];
    facetItems: FacetItem[];
    onToggleValue: (key: FilterKey, value: string) => void;
    onClearDimension: (key: FilterKey) => void;
}

export const pillBaseClass =
    'h-7 shrink-0 gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50';

// The dark:hover overrides beat Button ghost's `dark:hover:bg-accent/50` (indigo), which
// twMerge can't dedupe against a plain `hover:bg-*` (different variant stacks).
export function pillStateClass(isActive: boolean, isOpen = false): string {
    if (isActive) {
        return cn('border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15', isOpen && 'bg-primary/15');
    }

    return cn(
        'border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
        isOpen && 'bg-secondary text-foreground',
    );
}

/** One filter dimension as a dropdown pill: 1 click to open, live counts, value shown inline. */
export function FilterPill({ dimension, activeValues, facetItems, onToggleValue, onClearDimension }: FilterPillProps) {
    const [open, setOpen] = useState(false);
    const isActive = activeValues.length > 0;
    const Icon = dimension.icon;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" className={cn(pillBaseClass, pillStateClass(isActive, open))}>
                    <Icon className="size-3.5 shrink-0" />
                    <span className="max-w-48 truncate">{formatPillLabel(dimension, activeValues)}</span>
                    {isActive ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label={`Clear ${dimension.label} filter`}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setOpen(false);
                                onClearDimension(dimension.key);
                            }}
                            className="-mr-1 flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
                        >
                            <X className="size-3" />
                        </span>
                    ) : (
                        <ChevronDown className="size-3 shrink-0 opacity-60" />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-64 overflow-hidden rounded-xl border-border/50 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
            >
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: PANEL_EASE }}>
                    <FacetListPanel
                        dimension={dimension}
                        items={facetItems}
                        activeValues={activeValues}
                        onToggle={(value) => onToggleValue(dimension.key, value)}
                    />
                </motion.div>
            </PopoverContent>
        </Popover>
    );
}
