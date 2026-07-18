import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FacetItem, FilterKey, SearchFacets } from '@reverie/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FacetListPanel } from './FacetListPanel';
import type { FilterDimension } from './filter-defs';

interface DisclosureRowProps {
    icon: typeof ChevronDown;
    label: string;
    badgeCount?: number;
    expanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

/** A stacked row that expands inline (single-level disclosure, never a page swap). */
export function DisclosureRow({ icon: Icon, label, badgeCount, expanded, onToggle, children }: DisclosureRowProps) {
    return (
        <div>
            <Button
                type="button"
                variant="ghost"
                onClick={onToggle}
                className="h-auto w-full justify-start gap-2.5 rounded-none px-3 py-2 text-sm font-normal hover:bg-secondary dark:hover:bg-secondary"
            >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">{label}</span>
                {(badgeCount ?? 0) > 0 && (
                    <span className="flex size-4.5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {badgeCount}
                    </span>
                )}
                <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </Button>

            {expanded && <div className="border-y border-border/40 bg-secondary/30">{children}</div>}
        </div>
    );
}

interface DimensionDisclosureListProps {
    dimensions: FilterDimension[];
    filterValues: Map<FilterKey, string[]>;
    facets: SearchFacets | undefined;
    onToggleValue: (key: FilterKey, value: string) => void;
    /** Extra disclosure sections appended after the dimensions (e.g. the Date panel). */
    children?: (expandedKey: string | null, setExpandedKey: (key: string | null) => void) => React.ReactNode;
}

export function DimensionDisclosureList({ dimensions, filterValues, facets, onToggleValue, children }: DimensionDisclosureListProps) {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    return (
        <div>
            {dimensions.map((dimension) => (
                <DisclosureRow
                    key={dimension.key}
                    icon={dimension.icon}
                    label={dimension.label}
                    badgeCount={filterValues.get(dimension.key)?.length ?? 0}
                    expanded={expandedKey === dimension.key}
                    onToggle={() => setExpandedKey(expandedKey === dimension.key ? null : dimension.key)}
                >
                    <FacetListPanel
                        dimension={dimension}
                        items={facets?.[dimension.facetKey] ?? ([] as FacetItem[])}
                        activeValues={filterValues.get(dimension.key) ?? []}
                        onToggle={(value) => onToggleValue(dimension.key, value)}
                    />
                </DisclosureRow>
            ))}

            {children?.(expandedKey, setExpandedKey)}
        </div>
    );
}
