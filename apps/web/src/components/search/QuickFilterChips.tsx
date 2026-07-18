import { Button } from '@/components/ui/button';
import { useQuickFilters } from '@/lib/api/search';
import type { QuickFilter } from '@reverie/shared';
import { Clock, FileText, HardDrive, Image, ImageOff, Monitor, Receipt, Sparkles, TrendingUp, Video } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// Icon slugs are part of the quick-filters API contract (see backend quick-filters.ts)
const quickFilterIcons: Record<string, typeof FileText> = {
    image: Image,
    monitor: Monitor,
    'file-text': FileText,
    video: Video,
    receipt: Receipt,
    'trending-up': TrendingUp,
    clock: Clock,
    'hard-drive': HardDrive,
    sparkles: Sparkles,
    'image-off': ImageOff,
};

interface QuickFilterChipsProps {
    onSelect: (query: string) => void;
    /** Wrap each chip (e.g. in a cmdk Command.Item for keyboard nav). */
    renderItem?: (chip: ReactNode, filter: QuickFilter) => ReactNode;
    /** Staggered entrance for empty-state compositions. */
    staggered?: boolean;
    className?: string;
}

/**
 * The single consumer of GET /search/quick-filters — data-driven chips with
 * live counts (zero-count filters never arrive from the backend).
 */
export function QuickFilterChips({ onSelect, renderItem, staggered, className }: QuickFilterChipsProps) {
    const { data: quickFilters } = useQuickFilters();

    if (!quickFilters || quickFilters.length === 0) return null;

    return (
        <div className={className ?? 'flex flex-wrap gap-1.5'}>
            {quickFilters.map((filter, index) => {
                const Icon = filter.icon ? (quickFilterIcons[filter.icon] ?? FileText) : FileText;
                const chip = (
                    <Button
                        type="button"
                        variant="outline"
                        // In renderItem mode the wrapper (e.g. cmdk Command.Item) owns selection
                        onClick={renderItem ? undefined : () => onSelect(filter.query)}
                        className="h-8 gap-1.5 rounded-full px-3 text-xs transition-colors hover:border-primary/50 hover:bg-secondary hover:text-primary"
                    >
                        <Icon className="size-3.5 text-muted-foreground" />
                        {filter.label}
                        <span className="text-xs tabular-nums text-muted-foreground">{filter.count}</span>
                    </Button>
                );

                if (renderItem) return renderItem(chip, filter);

                if (!staggered) return <span key={filter.id}>{chip}</span>;

                return (
                    <motion.span
                        key={filter.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.06 + index * 0.04, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {chip}
                    </motion.span>
                );
            })}
        </div>
    );
}
