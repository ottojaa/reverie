import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FilterKey, QueryToken, SearchFacets } from '@reverie/shared';
import { useEffect, useState } from 'react';
import { DimensionDisclosureList } from './DimensionDisclosureList';
import { FILTER_DIMENSIONS } from './filter-defs';

export type TriState = 'any' | 'include' | 'exclude';

const SIZE_PRESETS = [
    { label: 'Any size', value: null },
    { label: 'Over 10 MB', value: '>10MB' },
    { label: 'Over 100 MB', value: '>100MB' },
    { label: 'Under 1 MB', value: '<1MB' },
];

/** Count of active filters the More panel owns exclusively (Text-contains + size). */
export function countMorePanelFilters(_tokens: QueryToken[], filterValues: Map<FilterKey, string[]>): number {
    const contentCount = filterValues.get('content')?.length ?? 0;
    const sizeCount = filterValues.get('size')?.length ?? 0;

    return contentCount + sizeCount;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</div>;
}

/**
 * Debounced text input that filters to documents whose OCR'd content contains the
 * phrase (the `content:` DSL filter → `ocr.raw_text ILIKE`). Replaces the old has:text
 * yes/no toggle — presence-of-text is rarely useful; "contains what?" usually is.
 */
function TextContainsRow({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
    const [draft, setDraft] = useState(value);

    // Re-sync when the committed value changes from outside (e.g. Clear all).
    useEffect(() => setDraft(value), [value]);

    // Debounce so each keystroke doesn't push a navigation.
    useEffect(() => {
        if (draft.trim() === value.trim()) return;

        const id = setTimeout(() => onCommit(draft.trim()), 250);

        return () => clearTimeout(id);
    }, [draft, value, onCommit]);

    return (
        <div className="px-3 py-1.5">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Text contains…" className="h-7 text-sm" />
        </div>
    );
}

interface PropertySectionsProps {
    tokens: QueryToken[];
    filterValues: Map<FilterKey, string[]>;
    onReplaceValue: (key: FilterKey, value: string) => void;
    onClearDimension: (key: FilterKey) => void;
    onSetValueState: (key: FilterKey, value: string, state: TriState) => void;
}

/** Property tri-state + size presets — shared between the More popover and the mobile drawer. */
export function PropertySections({ filterValues, onReplaceValue, onClearDimension }: PropertySectionsProps) {
    const activeSize = filterValues.get('size')?.[0] ?? null;
    const contentValue = filterValues.get('content')?.[0] ?? '';

    return (
        <>
            <MicroLabel>Properties</MicroLabel>
            <TextContainsRow value={contentValue} onCommit={(v) => (v ? onReplaceValue('content', v) : onClearDimension('content'))} />

            <MicroLabel>Size</MicroLabel>
            <div className="flex flex-wrap gap-1 px-3 py-1">
                {SIZE_PRESETS.map((preset) => {
                    const isActive = preset.value === activeSize;

                    return (
                        <Button
                            key={preset.label}
                            type="button"
                            variant="ghost"
                            onClick={() => (preset.value ? onReplaceValue('size', preset.value) : onClearDimension('size'))}
                            className={cn(
                                'h-6 rounded-full border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
                                isActive && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15',
                            )}
                        >
                            {preset.label}
                        </Button>
                    );
                })}
            </div>
        </>
    );
}

interface MoreFiltersPanelProps extends PropertySectionsProps {
    facets: SearchFacets | undefined;
    onToggleValue: (key: FilterKey, value: string) => void;
}

/**
 * The "More" pill's flat panel: property tri-state, size presets, and the
 * long-tail dimensions as single-level inline disclosures — never a page swap.
 */
export function MoreFiltersPanel({ facets, onToggleValue, ...propertyProps }: MoreFiltersPanelProps) {
    const secondaryDims = FILTER_DIMENSIONS.filter((dimension) => !dimension.primary);

    return (
        <div className="max-h-[min(70vh,28rem)] overflow-y-auto pb-1">
            <PropertySections {...propertyProps} />

            <div className="mx-3 mt-2 border-t border-border/40" />

            <DimensionDisclosureList dimensions={secondaryDims} filterValues={propertyProps.filterValues} facets={facets} onToggleValue={onToggleValue} />
        </div>
    );
}
