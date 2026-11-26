import type { FacetItem, FilterKey } from '@reverie/shared';
import { useState } from 'react';
import { FacetListPanel } from './FacetListPanel';
import { formatPillLabel, type FilterDimension } from './filter-defs';
import { PillPopover } from './PillPopover';

interface FilterPillProps {
    dimension: FilterDimension;
    activeValues: string[];
    facetItems: FacetItem[];
    onToggleValue: (key: FilterKey, value: string) => void;
    onClearDimension: (key: FilterKey) => void;
}

/** One filter dimension as a dropdown pill: 1 click to open, live counts, value shown inline. */
export function FilterPill({ dimension, activeValues, facetItems, onToggleValue, onClearDimension }: FilterPillProps) {
    const [open, setOpen] = useState(false);

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            icon={dimension.icon}
            label={formatPillLabel(dimension, activeValues)}
            isActive={activeValues.length > 0}
            clearLabel={`Clear ${dimension.label} filter`}
            onClear={() => onClearDimension(dimension.key)}
        >
            <FacetListPanel dimension={dimension} items={facetItems} activeValues={activeValues} onToggle={(value) => onToggleValue(dimension.key, value)} />
        </PillPopover>
    );
}
