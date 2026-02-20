import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatFilterChip } from '@reverie/shared';
import { Calendar, FileText, Folder, Hash, Image, MapPin, Minus, Search as SearchIcon, Sparkles, Tag, Type, X } from 'lucide-react';
import { memo, useState } from 'react';

/* ============================================================================
 * Types
 * ============================================================================ */

interface ActiveFilter {
    type: string;
    value: string;
    label: string;
}

interface ActiveFiltersProps {
    query: string;
    onRemoveFilter: (filter: ActiveFilter) => void;
    onClearAll: () => void;
}

/* ============================================================================
 * Filter extraction
 * ============================================================================ */

const QUOTED_OR_UNQUOTED = '(?:"([^"]+)"|(\\S+))';

const filterPatterns = [
    { regex: new RegExp(`type:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'type' },
    { regex: new RegExp(`format:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'format' },
    { regex: new RegExp(`category:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'category' },
    { regex: new RegExp(`folder:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'folder' },
    { regex: new RegExp(`tag:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'tag' },
    { regex: new RegExp(`entity:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'entity' },
    { regex: new RegExp(`company:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'company' },
    { regex: new RegExp(`location:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'location' },
    { regex: new RegExp(`uploaded:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'uploaded' },
    { regex: new RegExp(`date:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'date' },
    { regex: new RegExp(`has:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'has' },
    { regex: new RegExp(`-has:${QUOTED_OR_UNQUOTED}`, 'g'), type: '-has' },
    { regex: new RegExp(`size:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'size' },
    { regex: new RegExp(`in:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'in' },
];

function extractFilters(query: string): ActiveFilter[] {
    const filters: ActiveFilter[] = [];

    for (const { regex, type } of filterPatterns) {
        const pattern = new RegExp(regex.source, regex.flags);
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(query)) !== null) {
            const value = (match[1] ?? match[2] ?? '').trim();
            const label = match[0];

            filters.push({ type, value, label });
        }
    }

    return filters;
}

const ALL_FILTERS_REGEX = /-?\w+:(?:"[^"]*"|\S+)/g;

function getFreeText(query: string): string {
    return query.replace(ALL_FILTERS_REGEX, '').replace(/\s+/g, ' ').trim();
}

/* ============================================================================
 * Visual config per filter type
 * ============================================================================ */

type FilterColor = 'blue' | 'amber' | 'green' | 'purple' | 'rose' | 'slate';

const filterTypeConfig: Record<string, { icon: typeof FileText; color: FilterColor }> = {
    type: { icon: Image, color: 'blue' },
    format: { icon: FileText, color: 'blue' },
    category: { icon: Hash, color: 'blue' },
    folder: { icon: Folder, color: 'green' },
    tag: { icon: Tag, color: 'purple' },
    entity: { icon: Sparkles, color: 'rose' },
    company: { icon: Sparkles, color: 'rose' },
    location: { icon: MapPin, color: 'green' },
    uploaded: { icon: Calendar, color: 'amber' },
    date: { icon: Calendar, color: 'amber' },
    has: { icon: Type, color: 'slate' },
    '-has': { icon: Minus, color: 'slate' },
    size: { icon: FileText, color: 'slate' },
    in: { icon: SearchIcon, color: 'slate' },
};

const colorClasses: Record<FilterColor, { chip: string; icon: string }> = {
    blue: { chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-400', icon: 'text-blue-500/70' },
    amber: { chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', icon: 'text-amber-500/70' },
    green: { chip: 'bg-green-500/10 text-green-700 dark:text-green-400', icon: 'text-green-500/70' },
    purple: { chip: 'bg-purple-500/10 text-purple-700 dark:text-purple-400', icon: 'text-purple-500/70' },
    rose: { chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', icon: 'text-rose-500/70' },
    slate: { chip: 'bg-secondary text-secondary-foreground', icon: 'text-muted-foreground' },
};

/* ============================================================================
 * ActiveFilters component
 * ============================================================================ */

export const ActiveFilters = memo(function ActiveFilters({ query, onRemoveFilter, onClearAll }: ActiveFiltersProps) {
    const filters = extractFilters(query);
    const freeText = getFreeText(query);

    if (filters.length === 0) return null;

    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {freeText && (
                <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                    &ldquo;{freeText}&rdquo;
                </span>
            )}
            {filters.map((filter) => (
                <FilterChip key={filter.label} filter={filter} onRemove={() => onRemoveFilter(filter)} />
            ))}
            {filters.length > 1 && (
                <button type="button" onClick={onClearAll} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                    Clear all
                </button>
            )}
        </div>
    );
});

/* ============================================================================
 * Individual filter chip with inline edit popover
 * ============================================================================ */

function FilterChip({ filter, onRemove }: { filter: ActiveFilter; onRemove: () => void }) {
    const [open, setOpen] = useState(false);
    const config = filterTypeConfig[filter.type] ?? { icon: Hash, color: 'slate' as FilterColor };
    const Icon = config.icon;
    const colors = colorClasses[config.color];
    const humanLabel = formatFilterChip(filter.type, filter.value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <div className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', colors.chip)}>
                <PopoverTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 transition-opacity hover:opacity-80">
                        <Icon className={cn('size-3', colors.icon)} />
                        <span>{humanLabel}</span>
                    </button>
                </PopoverTrigger>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                >
                    <X className="size-2.5" />
                </button>
            </div>
            <PopoverContent align="start" sideOffset={4} className="w-48 p-2 text-sm">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {filter.type === 'uploaded' || filter.type === 'date' ? 'Date filter' : `${capitalize(filter.type)} filter`}
                </p>
                <p className="text-xs text-muted-foreground">
                    Current: <span className="font-medium text-foreground">{humanLabel}</span>
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">Use the Filters panel to change this value.</p>
            </PopoverContent>
        </Popover>
    );
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
