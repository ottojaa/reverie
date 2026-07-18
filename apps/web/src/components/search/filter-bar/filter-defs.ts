import { formatDateRange, formatFilterChip, type FilterKey, type SearchFacets, type SuggestionType } from '@reverie/shared';
import { Building2, FileText, Folder, Hash, Image, MapPin, Tag } from 'lucide-react';

export interface FilterDimension {
    key: FilterKey;
    label: string;
    icon: typeof Tag;
    facetKey: keyof SearchFacets;
    /** multi-or: values widen results; multi-and: each value narrows (tags). */
    select: 'multi-or' | 'multi-and';
    suggestionType?: SuggestionType;
    /** Primary dimensions get a permanent pill; the rest live under "More" until active. */
    primary?: boolean;
    /** Short explanation shown in the panel header. */
    description?: string;
    /** Friendly message when the library has no values for this dimension yet. */
    emptyHint?: string;
}

/**
 * Declarative config for the facet-list filter dimensions — the one place that
 * knows which dimensions exist and how each one selects. Dates are handled by
 * the dedicated Date pill (`DateFilterPill`, keys `uploaded`/`date`); `has`/`size`
 * belong to the More panel.
 */
export const FILTER_DIMENSIONS: FilterDimension[] = [
    { key: 'type', label: 'Type', icon: Image, facetKey: 'types', select: 'multi-or', primary: true },
    { key: 'category', label: 'Category', icon: Hash, facetKey: 'categories', select: 'multi-or', primary: true },
    { key: 'folder', label: 'Folder', icon: Folder, facetKey: 'folders', select: 'multi-or', suggestionType: 'folder', primary: true },
    {
        key: 'tag',
        label: 'Tags',
        icon: Tag,
        facetKey: 'tags',
        select: 'multi-and',
        suggestionType: 'tag',
        primary: true,
        description: 'Topics Reverie picks out of each document — companies, themes, places. Combine tags to narrow down.',
        emptyHint: 'Tags appear here once your documents have been processed.',
    },
    { key: 'format', label: 'Format', icon: FileText, facetKey: 'formats', select: 'multi-or' },
    { key: 'location', label: 'Location', icon: MapPin, facetKey: 'locations', select: 'multi-or', suggestionType: 'location' },
    { key: 'entity', label: 'Company', icon: Building2, facetKey: 'entities', select: 'multi-or', suggestionType: 'entity' },
];

export function getDimension(key: FilterKey): FilterDimension | undefined {
    return FILTER_DIMENSIONS.find((dimension) => dimension.key === key);
}

/** Human label for a single filter value (folders show their last path segment). */
export function formatFilterValue(key: FilterKey, value: string): string {
    if (key === 'folder') return value.split('/').filter(Boolean).at(-1) ?? value;

    if (key === 'uploaded' || key === 'date') return formatDateRange(value);

    return formatFilterChip(key, value);
}

/** Pill label: `Type` → `Type: Photos` → `Type: Photos +1`. */
export function formatPillLabel(dimension: FilterDimension, values: string[]): string {
    if (values.length === 0) return dimension.label;

    const first = formatFilterValue(dimension.key, values[0] ?? '');

    if (values.length === 1) return `${dimension.label}: ${first}`;

    return `${dimension.label}: ${first} +${values.length - 1}`;
}
