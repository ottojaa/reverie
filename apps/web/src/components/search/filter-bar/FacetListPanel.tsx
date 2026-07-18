import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearchSuggestions } from '@/lib/api/search';
import { cn } from '@/lib/utils';
import type { FacetItem } from '@reverie/shared';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatFilterValue, type FilterDimension } from './filter-defs';

interface FacetListPanelProps {
    dimension: FilterDimension;
    items: FacetItem[];
    activeValues: string[];
    onToggle: (value: string) => void;
}

interface PanelRow {
    value: string;
    count: number | null;
    selected: boolean;
}

function toPanelRows(items: FacetItem[], activeValues: string[], search: string, suggestions: string[] | undefined): PanelRow[] {
    const activeLower = new Set(activeValues.map((value) => value.toLowerCase()));
    const isSelected = (value: string) => activeLower.has(value.toLowerCase());

    if (search && suggestions) {
        return suggestions.map((value) => ({ value, count: null, selected: isSelected(value) }));
    }

    const lower = search.toLowerCase();
    const listed = items.filter((item) => !search || item.name.toLowerCase().includes(lower));
    const listedLower = new Set(listed.map((item) => item.name.toLowerCase()));
    // Active values missing from the facet list (e.g. added via suggestions) stay visible
    const pinned: PanelRow[] = activeValues.filter((value) => !listedLower.has(value.toLowerCase())).map((value) => ({ value, count: null, selected: true }));
    const rows = listed.map((item) => ({ value: item.name, count: item.count, selected: isSelected(item.name) }));

    return [...pinned, ...rows.filter((row) => row.selected), ...rows.filter((row) => !row.selected)];
}

/**
 * Checkbox list for one filter dimension, built from full-corpus facets.
 * Dimensions with a `suggestionType` get a search input that switches the
 * list to /search/suggest results for the long tail.
 */
export function FacetListPanel({ dimension, items, activeValues, onToggle }: FacetListPanelProps) {
    const [search, setSearch] = useState('');
    const useSuggest = Boolean(dimension.suggestionType) && search.length > 0;
    const { data: suggestions, isLoading: suggestLoading } = useSearchSuggestions(dimension.suggestionType ?? 'filename', useSuggest ? search : '', 12);

    const rows = useMemo(
        () => toPanelRows(items, activeValues, search, useSuggest ? suggestions : undefined),
        [items, activeValues, search, useSuggest, suggestions],
    );

    const showSearch = Boolean(dimension.suggestionType) || items.length > 8;
    const isEmpty = rows.length === 0 && !(useSuggest && suggestLoading);

    return (
        <div className="flex flex-col">
            <div className="px-3 pb-1.5 pt-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{dimension.label}</span>
                {dimension.description && <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground/70">{dimension.description}</p>}
            </div>

            {showSearch && (
                <div className="px-2 pb-1">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${dimension.label.toLowerCase()}...`}
                            className="h-8 pl-8 pr-3 text-sm"
                        />
                    </div>
                </div>
            )}

            <div className="max-h-64 overflow-y-auto p-1">
                {rows.map((row) => (
                    <Button
                        key={row.value}
                        type="button"
                        variant="ghost"
                        onClick={() => onToggle(row.value)}
                        className="h-auto w-full justify-start gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-secondary dark:hover:bg-secondary"
                    >
                        <span
                            className={cn(
                                'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                                row.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                            )}
                        >
                            {row.selected && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left" title={row.value}>
                            {formatFilterValue(dimension.key, row.value)}
                        </span>
                        {row.count !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.count}</span>}
                    </Button>
                ))}

                {useSuggest && suggestLoading && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Searching...</p>}
                {isEmpty && (
                    <p className="px-3 py-4 text-center text-sm leading-relaxed text-muted-foreground">
                        {search ? 'No matches' : (dimension.emptyHint ?? `No ${dimension.label.toLowerCase()} in your library yet`)}
                    </p>
                )}
            </div>
        </div>
    );
}
