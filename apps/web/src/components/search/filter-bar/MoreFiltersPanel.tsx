import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FilterKey, QueryToken, SearchFacets } from '@reverie/shared';
import { DimensionDisclosureList } from './DimensionDisclosureList';
import { FILTER_DIMENSIONS } from './filter-defs';

export type TriState = 'any' | 'include' | 'exclude';

const SIZE_PRESETS = [
    { label: 'Any size', value: null },
    { label: 'Over 10 MB', value: '>10MB' },
    { label: 'Over 100 MB', value: '>100MB' },
    { label: 'Under 1 MB', value: '<1MB' },
];

const TRI_STATE_OPTIONS: Array<{ label: string; value: TriState }> = [
    { label: 'Any', value: 'any' },
    { label: 'Yes', value: 'include' },
    { label: 'No', value: 'exclude' },
];

export function getTriState(tokens: QueryToken[], key: FilterKey, value: string): TriState {
    const token = tokens.find((t) => t.type === 'filter' && t.key === key && t.value.toLowerCase() === value);

    if (!token) return 'any';

    return token.negated ? 'exclude' : 'include';
}

/** Count of active filters the More panel owns exclusively (has:text tri-state + size). */
export function countMorePanelFilters(tokens: QueryToken[], filterValues: Map<FilterKey, string[]>): number {
    const hasTextCount = tokens.filter((t) => t.type === 'filter' && t.key === 'has' && t.value.toLowerCase() === 'text').length;
    const sizeCount = filterValues.get('size')?.length ?? 0;

    return hasTextCount + sizeCount;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</div>;
}

function TriStateRow({ label, state, onChange }: { label: string; state: TriState; onChange: (state: TriState) => void }) {
    return (
        <div className="flex items-center justify-between gap-2 px-3 py-1">
            <span className="text-sm">{label}</span>
            <div className="flex rounded-md border border-border/60 p-0.5">
                {TRI_STATE_OPTIONS.map((option) => (
                    <Button
                        key={option.value}
                        type="button"
                        variant="ghost"
                        onClick={() => onChange(option.value)}
                        className={cn(
                            'h-5 rounded-[5px] px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
                            state === option.value && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15',
                        )}
                    >
                        {option.label}
                    </Button>
                ))}
            </div>
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
export function PropertySections({ tokens, filterValues, onReplaceValue, onClearDimension, onSetValueState }: PropertySectionsProps) {
    const activeSize = filterValues.get('size')?.[0] ?? null;

    return (
        <>
            <MicroLabel>Properties</MicroLabel>
            <TriStateRow label="Text" state={getTriState(tokens, 'has', 'text')} onChange={(state) => onSetValueState('has', 'text', state)} />

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
