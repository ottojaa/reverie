import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import type { SearchQueryState } from '@/lib/hooks/useSearchQuery';
import { cn } from '@/lib/utils';
import { isKnownFilter, type SearchFacets } from '@reverie/shared';
import { Calendar, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { DateFilterPanel } from './DateFilterPanel';
import { DimensionDisclosureList, DisclosureRow } from './DimensionDisclosureList';
import { FILTER_DIMENSIONS } from './filter-defs';
import { pillBaseClass, pillStateClass } from './FilterPill';
import { PropertySections } from './MoreFiltersPanel';

interface MobileFilterDrawerProps {
    search: SearchQueryState;
    facets: SearchFacets | undefined;
    total: number;
}

/** Mobile counterpart of the filter bar: one "Filters (n)" pill opening a bottom drawer. */
export function MobileFilterDrawer({ search, facets, total }: MobileFilterDrawerProps) {
    const [open, setOpen] = useState(false);
    const activeTokenCount = search.tokens.filter(isKnownFilter).length;
    const dateCount = (search.filterValues.get('uploaded')?.length ?? 0) + (search.filterValues.get('date')?.length ?? 0);

    return (
        <Drawer open={open} onOpenChange={setOpen} direction="bottom">
            <DrawerTrigger asChild>
                <Button type="button" variant="ghost" className={cn(pillBaseClass, pillStateClass(activeTokenCount > 0, open))}>
                    <SlidersHorizontal className="size-3.5 shrink-0" />
                    <span>Filters</span>
                    {activeTokenCount > 0 && <span className="tabular-nums">({activeTokenCount})</span>}
                </Button>
            </DrawerTrigger>
            <DrawerContent className="flex max-h-[85vh] flex-col overflow-hidden border-t p-0">
                <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2.5">
                    <span className="text-sm font-medium">Filters</span>
                    {activeTokenCount > 0 && (
                        <Button type="button" variant="ghost" size="sm" onClick={search.clearAllFilters} className="text-xs text-muted-foreground">
                            Clear all
                        </Button>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                    <DimensionDisclosureList
                        dimensions={FILTER_DIMENSIONS}
                        filterValues={search.filterValues}
                        facets={facets}
                        onToggleValue={search.toggleFilterValue}
                    >
                        {(expandedKey, setExpandedKey) => (
                            <DisclosureRow
                                icon={Calendar}
                                label="Date"
                                badgeCount={dateCount}
                                expanded={expandedKey === '__date'}
                                onToggle={() => setExpandedKey(expandedKey === '__date' ? null : '__date')}
                            >
                                <DateFilterPanel
                                    uploadedValue={search.filterValues.get('uploaded')?.[0] ?? null}
                                    dateValue={search.filterValues.get('date')?.[0] ?? null}
                                    onSetValue={search.setFilterValue}
                                    onClear={search.removeDimension}
                                />
                            </DisclosureRow>
                        )}
                    </DimensionDisclosureList>

                    <div className="mx-3 my-1 border-t border-border/40" />

                    <PropertySections
                        tokens={search.tokens}
                        filterValues={search.filterValues}
                        onReplaceValue={search.setFilterValue}
                        onClearDimension={search.removeDimension}
                        onSetValueState={search.setFilterValueState}
                    />
                </div>

                <div className="shrink-0 border-t border-border/40 p-3">
                    <Button type="button" onClick={() => setOpen(false)} className="w-full">
                        Show {total.toLocaleString()} result{total === 1 ? '' : 's'}
                    </Button>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
