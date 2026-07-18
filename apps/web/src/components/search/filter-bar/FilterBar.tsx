import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSearchFacets } from '@/lib/api/search';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import type { SearchQueryState } from '@/lib/hooks/useSearchQuery';
import { cn } from '@/lib/utils';
import { formatFilterChip, isKnownFilter, removeFilter, type QueryToken } from '@reverie/shared';
import { SlidersHorizontal, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { DateFilterPill } from './DateFilterPill';
import { FILTER_DIMENSIONS } from './filter-defs';
import { FilterPill, PANEL_EASE, pillBaseClass, pillStateClass } from './FilterPill';
import { MobileFilterDrawer } from './MobileFilterDrawer';
import { countMorePanelFilters, MoreFiltersPanel } from './MoreFiltersPanel';

interface FilterBarProps {
    search: SearchQueryState;
    total: number;
}

const DIMENSION_KEYS = new Set<string>(FILTER_DIMENSIONS.map((dimension) => dimension.key));

/** Tokens the pills don't own — negations, scopes, stray has: and size values — rendered as removable chips so the bar stays a lossless view of `q`. */
function getUnmanagedTokens(tokens: QueryToken[]): QueryToken[] {
    return tokens.filter((token) => {
        if (!isKnownFilter(token) || !token.key) return false;

        if (token.negated) return true;

        // content (Text-contains) and size live in the More panel; every other off-pill filter is a chip
        return !DIMENSION_KEYS.has(token.key) && !['uploaded', 'date', 'size', 'content'].includes(token.key);
    });
}

function formatUnmanagedLabel(token: QueryToken): string {
    const label = formatFilterChip(token.negated && token.key === 'has' ? '-has' : (token.key ?? ''), token.value);

    return token.negated && token.key !== 'has' ? `Not ${label}` : label;
}

/**
 * The persistent filter pill row under the search input. Primary dimensions
 * always show; secondary dimensions get promoted to a pill while active and
 * otherwise live under "More". Facet values are full-corpus (never narrowed
 * by the active query) so every filter is always available.
 */
export function FilterBar({ search, total }: FilterBarProps) {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [moreOpen, setMoreOpen] = useState(false);
    const { data: facets } = useSearchFacets();

    const { tokens, filterValues, activeDimensionCount } = search;
    const primaryDims = FILTER_DIMENSIONS.filter((dimension) => dimension.primary);
    const promotedDims = FILTER_DIMENSIONS.filter((dimension) => !dimension.primary && (filterValues.get(dimension.key)?.length ?? 0) > 0);
    const unmanagedTokens = getUnmanagedTokens(tokens);
    const moreCount = countMorePanelFilters(tokens, filterValues);

    if (!isDesktop) {
        return <MobileFilterDrawer search={search} facets={facets} total={total} />;
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {[...primaryDims, ...promotedDims].map((dimension) => (
                <FilterPill
                    key={dimension.key}
                    dimension={dimension}
                    activeValues={filterValues.get(dimension.key) ?? []}
                    facetItems={facets?.[dimension.facetKey] ?? []}
                    onToggleValue={search.toggleFilterValue}
                    onClearDimension={search.removeDimension}
                />
            ))}

            <DateFilterPill
                uploadedValue={filterValues.get('uploaded')?.[0] ?? null}
                dateValue={filterValues.get('date')?.[0] ?? null}
                onSetValue={search.setFilterValue}
                onClearField={search.removeDimension}
                onClearAll={() => search.setQuery(removeFilter(removeFilter(search.q, 'uploaded'), 'date'))}
            />

            {/* More */}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" className={cn(pillBaseClass, pillStateClass(moreCount > 0, moreOpen))}>
                        <SlidersHorizontal className="size-3.5 shrink-0" />
                        <span>More</span>
                        {moreCount > 0 && <span className="tabular-nums">·{moreCount}</span>}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-72 overflow-hidden rounded-xl border-border/50 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
                >
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: PANEL_EASE }}>
                        <MoreFiltersPanel
                            tokens={tokens}
                            filterValues={filterValues}
                            facets={facets}
                            onToggleValue={search.toggleFilterValue}
                            onReplaceValue={search.setFilterValue}
                            onClearDimension={search.removeDimension}
                            onSetValueState={search.setFilterValueState}
                        />
                    </motion.div>
                </PopoverContent>
            </Popover>

            {/* Tokens the pills don't manage (negations, scopes) — still visible, still removable */}
            {unmanagedTokens.map((token) => (
                <span key={token.raw + token.value} className={cn(pillBaseClass, pillStateClass(true), 'cursor-default')}>
                    <span className="max-w-48 truncate">{formatUnmanagedLabel(token)}</span>
                    <Button
                        type="button"
                        variant="ghost"
                        aria-label="Remove filter"
                        onClick={() => search.removeToken(token)}
                        className="-mr-1 size-4 rounded-full p-0 text-primary hover:bg-primary/20 hover:text-primary"
                    >
                        <X className="size-3" />
                    </Button>
                </span>
            ))}

            {activeDimensionCount >= 2 && (
                <Button
                    type="button"
                    variant="ghost"
                    onClick={search.clearAllFilters}
                    className="h-7 px-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary"
                >
                    Clear all
                </Button>
            )}
        </div>
    );
}
