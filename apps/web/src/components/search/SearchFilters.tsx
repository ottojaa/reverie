import { Calendar, FileText, Folder, Hash, Sparkles, Tag, Type, X } from 'lucide-react';
import { memo } from 'react';

/* ============================================================================
 * Active Filter Chips (shown below the search bar)
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

const QUOTED_OR_UNQUOTED = '(?:"([^"]+)"|(\\S+))';

const filterPatterns = [
    { regex: new RegExp(`type:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'type', icon: FileText },
    { regex: new RegExp(`format:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'format', icon: FileText },
    { regex: new RegExp(`category:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'category', icon: Hash },
    { regex: new RegExp(`folder:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'folder', icon: Folder },
    { regex: new RegExp(`tag:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'tag', icon: Tag },
    { regex: new RegExp(`entity:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'entity', icon: Sparkles },
    { regex: new RegExp(`company:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'company', icon: Sparkles },
    { regex: new RegExp(`uploaded:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'uploaded', icon: Calendar },
    { regex: new RegExp(`date:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'date', icon: Calendar },
    { regex: new RegExp(`has:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'has', icon: Type },
    { regex: new RegExp(`-has:${QUOTED_OR_UNQUOTED}`, 'g'), type: '-has', icon: Type },
    { regex: new RegExp(`size:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'size', icon: FileText },
    { regex: new RegExp(`in:${QUOTED_OR_UNQUOTED}`, 'g'), type: 'in', icon: Type },
];

function extractFilters(query: string): ActiveFilter[] {
    const filters: ActiveFilter[] = [];

    for (const { regex, type } of filterPatterns) {
        const pattern = new RegExp(regex.source, regex.flags);
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(query)) !== null) {
            const value = (match[1] ?? match[2] ?? '').trim();
            const label = match[0];

            filters.push({
                type,
                value,
                label,
            });
        }
    }

    return filters;
}

const ALL_FILTERS_REGEX = /-?\w+:(?:"[^"]*"|\S+)/g;

function getFreeText(query: string): string {
    return query.replace(ALL_FILTERS_REGEX, '').replace(/\s+/g, ' ').trim();
}

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
            {filters.map((filter) => {
                const pattern = filterPatterns.find((p) => p.type === filter.type);
                const Icon = pattern?.icon ?? Hash;

                return (
                    <span key={filter.label} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                        <Icon className="size-3" />
                        {filter.label}
                        <button type="button" onClick={() => onRemoveFilter(filter)} className="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-primary/20">
                            <X className="size-2.5" />
                        </button>
                    </span>
                );
            })}
            {filters.length > 1 && (
                <button type="button" onClick={onClearAll} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                    Clear all
                </button>
            )}
        </div>
    );
});
