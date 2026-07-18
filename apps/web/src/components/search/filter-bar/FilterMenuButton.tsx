import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSearchFacets } from '@/lib/api/search';
import { addFilter, getFilterTokens, isKnownFilter, removeFilter, replaceFilter, tokenizeQuery, type FilterKey } from '@reverie/shared';
import { Calendar, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { DateFilterPanel } from './DateFilterPanel';
import { DimensionDisclosureList, DisclosureRow } from './DimensionDisclosureList';
import { FILTER_DIMENSIONS } from './filter-defs';
import { PropertySections, type TriState } from './MoreFiltersPanel';

interface FilterMenuButtonProps {
    query: string;
    onQueryChange: (query: string) => void;
}

/**
 * Compact single-button filter menu for embedded contexts (e.g. Organize)
 * where the full pill bar doesn't fit. Same panels, token-level mutations.
 */
export function FilterMenuButton({ query, onQueryChange }: FilterMenuButtonProps) {
    const { data: facets } = useSearchFacets();
    const tokens = useMemo(() => tokenizeQuery(query), [query]);
    const activeCount = tokens.filter(isKnownFilter).length;

    const filterValues = useMemo(() => {
        const map = new Map<FilterKey, string[]>();

        for (const token of getFilterTokens(tokens)) {
            if (token.negated || !token.key) continue;

            const key = token.key as FilterKey;
            map.set(key, [...(map.get(key) ?? []), token.value]);
        }

        return map;
    }, [tokens]);

    const toggleValue = useCallback(
        (key: FilterKey, value: string) => {
            const exists = getFilterTokens(tokenizeQuery(query), key).some((token) => !token.negated && token.value.toLowerCase() === value.toLowerCase());

            onQueryChange(exists ? removeFilter(query, key, value) : addFilter(query, key, value));
        },
        [query, onQueryChange],
    );

    const replaceValue = useCallback((key: FilterKey, value: string) => onQueryChange(replaceFilter(query, key, value)), [query, onQueryChange]);
    const clearDimension = useCallback((key: FilterKey) => onQueryChange(removeFilter(query, key)), [query, onQueryChange]);

    const setValueState = useCallback(
        (key: FilterKey, value: string, state: TriState) => {
            const without = removeFilter(query, key, value);

            onQueryChange(state === 'any' ? without : addFilter(without, key, value, { negated: state === 'exclude' }));
        },
        [query, onQueryChange],
    );

    const dateCount = (filterValues.get('uploaded')?.length ?? 0) + (filterValues.get('date')?.length ?? 0);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <SlidersHorizontal className="size-3.5" />
                    <span className="hidden sm:inline">Filter</span>
                    {activeCount > 0 && (
                        <span className="flex size-4.5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={8}
                className="w-72 overflow-hidden rounded-xl border-border/50 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
            >
                <div className="max-h-[min(70vh,28rem)] overflow-y-auto pb-1">
                    <DimensionDisclosureList dimensions={FILTER_DIMENSIONS} filterValues={filterValues} facets={facets} onToggleValue={toggleValue}>
                        {(expandedKey, setExpandedKey) => (
                            <DisclosureRow
                                icon={Calendar}
                                label="Date"
                                badgeCount={dateCount}
                                expanded={expandedKey === '__date'}
                                onToggle={() => setExpandedKey(expandedKey === '__date' ? null : '__date')}
                            >
                                <DateFilterPanel
                                    uploadedValue={filterValues.get('uploaded')?.[0] ?? null}
                                    dateValue={filterValues.get('date')?.[0] ?? null}
                                    onSetValue={replaceValue}
                                    onClear={clearDimension}
                                />
                            </DisclosureRow>
                        )}
                    </DimensionDisclosureList>

                    <div className="mx-3 my-1 border-t border-border/40" />

                    <PropertySections
                        tokens={tokens}
                        filterValues={filterValues}
                        onReplaceValue={replaceValue}
                        onClearDimension={clearDimension}
                        onSetValueState={setValueState}
                    />
                </div>
            </PopoverContent>
        </Popover>
    );
}
