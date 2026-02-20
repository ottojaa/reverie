import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSearchSuggestions } from '@/lib/api/search';
import { cn } from '@/lib/utils';
import type { FacetItem, SearchFacets, SuggestionType } from '@reverie/shared';
import {
    ArrowLeft,
    Calendar as CalendarIcon,
    Check,
    ChevronRight,
    FileText,
    Folder,
    Hash,
    Image,
    MapPin,
    Search,
    SlidersHorizontal,
    Tag,
    X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';

type FilterType = 'type' | 'format' | 'category' | 'folder' | 'tag' | 'entity' | 'uploaded' | 'date' | 'location';

interface FilterDefinition {
    key: FilterType;
    label: string;
    icon: typeof FileText;
    prefix: string;
    mode: 'list' | 'searchable' | 'date';
    suggestionType?: SuggestionType;
}

const FILTER_DEFS: FilterDefinition[] = [
    { key: 'type', label: 'Type', icon: Image, prefix: 'type', mode: 'list' },
    { key: 'format', label: 'Format', icon: FileText, prefix: 'format', mode: 'list' },
    { key: 'category', label: 'Category', icon: Hash, prefix: 'category', mode: 'list' },
    { key: 'folder', label: 'Folder', icon: Folder, prefix: 'folder', mode: 'searchable', suggestionType: 'folder' },
    { key: 'tag', label: 'Tag', icon: Tag, prefix: 'tag', mode: 'searchable', suggestionType: 'tag' },
    { key: 'location', label: 'Location', icon: MapPin, prefix: 'location', mode: 'searchable', suggestionType: 'location' },
    { key: 'uploaded', label: 'Upload date', icon: CalendarIcon, prefix: 'uploaded', mode: 'date' },
    { key: 'date', label: 'Document date', icon: CalendarIcon, prefix: 'date', mode: 'date' },
];

interface SearchFilterPopoverProps {
    currentQuery: string;
    facets?: SearchFacets;
    onAddFilter: (filter: string) => void;
    onRemoveFilter: (filter: string) => void;
    onReplaceFilter: (prefix: string, newValue: string) => void;
}

const FILTER_REGEX = /(?:^|\s)(-?\w+):(?:"([^"]+)"|(\S+))/g;

function extractActiveFilters(query: string): Map<string, Set<string>> {
    const active = new Map<string, Set<string>>();
    const regex = new RegExp(FILTER_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(query)) !== null) {
        const prefix = match[1] ?? '';
        const value = (match[2] ?? match[3] ?? '').trim();

        if (!active.has(prefix)) active.set(prefix, new Set());

        active.get(prefix)!.add(value);
    }

    return active;
}

function countActiveFilters(query: string): number {
    const regex = /(?:^|\s)-?\w+:(?:"[^"]+"|\S+)/g;
    const matches = query.match(regex);

    return matches?.length ?? 0;
}

export const SearchFilterPopover = memo(function SearchFilterPopover({
    currentQuery,
    facets,
    onAddFilter,
    onRemoveFilter,
    onReplaceFilter,
}: SearchFilterPopoverProps) {
    const [open, setOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<FilterType | null>(null);

    const activeFilters = useMemo(() => extractActiveFilters(currentQuery), [currentQuery]);
    const activeCount = useMemo(() => countActiveFilters(currentQuery), [currentQuery]);

    const handleBack = useCallback(() => setActivePanel(null), []);

    const handleClearAll = useCallback(() => {
        const allFilters = currentQuery.match(/(?:^|\s)-?\w+:(?:"[^"]+"|\S+)/g);

        if (!allFilters) return;

        for (const filter of allFilters) {
            onRemoveFilter(filter.trim());
        }
    }, [currentQuery, onRemoveFilter]);

    const activeDef = activePanel ? FILTER_DEFS.find((d) => d.key === activePanel) : null;

    return (
        <Popover
            open={open}
            onOpenChange={(v) => {
                setOpen(v);

                if (!v) setActivePanel(null);
            }}
        >
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <SlidersHorizontal className="size-3.5" />
                    <span className="hidden sm:inline">Filter</span>
                    {activeCount > 0 && (
                        <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-80 overflow-hidden p-0">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <div className="flex items-center gap-2">
                        {activePanel && (
                            <button
                                type="button"
                                onClick={handleBack}
                                className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <ArrowLeft className="size-4" />
                            </button>
                        )}
                        <span className="text-sm font-medium">{activeDef?.label ?? 'Filters'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        {activeCount > 0 && !activePanel && (
                            <button
                                type="button"
                                onClick={handleClearAll}
                                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                Clear
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                        >
                            Done
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="relative overflow-hidden">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {!activePanel ? (
                            <motion.div
                                key="list"
                                initial={{ x: -20, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: -20, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                                className="py-1"
                            >
                                {FILTER_DEFS.map((def) => {
                                    const filterValues = activeFilters.get(def.prefix);
                                    const count = filterValues?.size ?? 0;

                                    return (
                                        <button
                                            key={def.key}
                                            type="button"
                                            onClick={() => setActivePanel(def.key)}
                                            className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                                        >
                                            <def.icon className="size-4 shrink-0 text-muted-foreground" />
                                            <span className="flex-1 text-left">{def.label}</span>
                                            {count > 0 && (
                                                <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                                                    {count}
                                                </span>
                                            )}
                                            <ChevronRight className="size-3.5 text-muted-foreground" />
                                        </button>
                                    );
                                })}
                            </motion.div>
                        ) : (
                            <motion.div
                                key={activePanel}
                                initial={{ x: 20, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: 20, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                            >
                                {activeDef?.mode === 'list' && (
                                    <ListFilterPanel
                                        prefix={activeDef.prefix}
                                        items={getFacetItems(facets, activeDef.key)}
                                        activeValues={activeFilters.get(activeDef.prefix) ?? new Set()}
                                        onToggle={(value) => {
                                            const encoded = value.includes(' ') ? `"${value}"` : value;
                                            const filter = `${activeDef.prefix}:${encoded}`;

                                            if (activeFilters.get(activeDef.prefix)?.has(value)) {
                                                onRemoveFilter(filter);
                                            } else {
                                                onAddFilter(filter);
                                            }
                                        }}
                                    />
                                )}
                                {activeDef?.mode === 'searchable' && activeDef.suggestionType && (
                                    <SearchableFilterPanel
                                        prefix={activeDef.prefix}
                                        suggestionType={activeDef.suggestionType}
                                        activeValues={activeFilters.get(activeDef.prefix) ?? new Set()}
                                        onToggle={(value) => {
                                            const encoded = value.includes(' ') ? `"${value}"` : value;
                                            const filter = `${activeDef.prefix}:${encoded}`;

                                            if (activeFilters.get(activeDef.prefix)?.has(value)) {
                                                onRemoveFilter(filter);
                                            } else {
                                                onAddFilter(filter);
                                            }
                                        }}
                                    />
                                )}
                                {activeDef?.mode === 'date' && (
                                    <DateFilterPanel
                                        prefix={activeDef.prefix}
                                        activeValues={activeFilters.get(activeDef.prefix) ?? new Set()}
                                        onSetFilter={(value) => onReplaceFilter(activeDef.prefix, value)}
                                        onClear={() => {
                                            const existing = activeFilters.get(activeDef.prefix);

                                            if (existing) {
                                                for (const v of existing) {
                                                    onRemoveFilter(`${activeDef.prefix}:${v}`);
                                                }
                                            }
                                        }}
                                    />
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </PopoverContent>
        </Popover>
    );
});

function getFacetItems(facets: SearchFacets | undefined, key: FilterType): FacetItem[] {
    if (!facets) return [];

    switch (key) {
        case 'type':
            return facets.types;
        case 'format':
            return facets.formats;
        case 'category':
            return facets.categories;
        case 'folder':
            return facets.folders;
        case 'tag':
            return facets.tags;
        case 'entity':
            return facets.entities ?? [];
        case 'location':
            return facets.locations ?? [];
        default:
            return [];
    }
}

/* ============================================================================
 * List Filter Panel -- for type, format, category (shows facet items with counts)
 * ============================================================================ */

interface ListFilterPanelProps {
    prefix: string;
    items: FacetItem[];
    activeValues: Set<string>;
    onToggle: (value: string) => void;
}

function ListFilterPanel({ prefix, items, activeValues, onToggle }: ListFilterPanelProps) {
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        if (!search) return items;

        const lower = search.toLowerCase();

        return items.filter((item) => item.name.toLowerCase().includes(lower));
    }, [items, search]);

    return (
        <div className="flex flex-col">
            {items.length > 5 && (
                <div className="border-b border-border px-3 py-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search ${prefix}s...`}
                            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
                        />
                    </div>
                </div>
            )}
            <div className="max-h-64 overflow-y-auto py-1">
                {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No options found</p>}
                {filtered.map((item) => {
                    const isActive = activeValues.has(item.name);

                    return (
                        <button
                            key={item.name}
                            type="button"
                            onClick={() => onToggle(item.name)}
                            className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                        >
                            <div
                                className={cn(
                                    'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                                    isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                                )}
                            >
                                {isActive && <Check className="size-3" />}
                            </div>
                            <span className="flex-1 truncate text-left">{formatFacetName(item.name)}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.count}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/* ============================================================================
 * Searchable Filter Panel -- for tag, entity, folder (queries /suggest endpoint)
 * ============================================================================ */

interface SearchableFilterPanelProps {
    prefix: string;
    suggestionType: SuggestionType;
    activeValues: Set<string>;
    onToggle: (value: string) => void;
}

function SearchableFilterPanel({ prefix, suggestionType, activeValues, onToggle }: SearchableFilterPanelProps) {
    const [search, setSearch] = useState('');
    const { data: suggestions, isLoading } = useSearchSuggestions(suggestionType, search, 12);

    const activeArray = useMemo(() => Array.from(activeValues), [activeValues]);

    return (
        <div className="flex flex-col">
            <div className="border-b border-border px-3 py-2">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`Search ${prefix}s...`}
                        autoFocus
                        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/30 focus:outline-none"
                    />
                </div>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
                {/* Active values first */}
                {activeArray.length > 0 && !search && (
                    <>
                        {activeArray.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => onToggle(value)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                            >
                                <div className="flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground transition-colors">
                                    <Check className="size-3" />
                                </div>
                                <span className="flex-1 truncate text-left">{value}</span>
                                <X className="size-3 text-muted-foreground" />
                            </button>
                        ))}
                        <div className="mx-3 my-1 border-t border-border" />
                    </>
                )}

                {/* Search results */}
                {search &&
                    suggestions &&
                    suggestions.length > 0 &&
                    suggestions.map((suggestion) => {
                        const isActive = activeValues.has(suggestion);

                        return (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => onToggle(suggestion)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                            >
                                <div
                                    className={cn(
                                        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                                        isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                                    )}
                                >
                                    {isActive && <Check className="size-3" />}
                                </div>
                                <span className="flex-1 truncate text-left">{suggestion}</span>
                            </button>
                        );
                    })}

                {search && isLoading && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Searching...</p>}

                {search && !isLoading && suggestions && suggestions.length === 0 && (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">No {prefix}s found</p>
                )}

                {!search && activeArray.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Type to search {prefix}s</p>}
            </div>
        </div>
    );
}

/* ============================================================================
 * Date Filter Panel -- presets + calendar range picker
 * ============================================================================ */

interface DateFilterPanelProps {
    prefix: string;
    activeValues: Set<string>;
    onSetFilter: (value: string) => void;
    onClear: () => void;
}

const DATE_PRESETS = [
    { label: 'This week', value: 'last-week' },
    { label: 'This month', value: 'last-month' },
    { label: 'This year', value: 'last-year' },
    { label: 'Last year', value: `${new Date().getFullYear() - 1}` },
];

function DateFilterPanel({ activeValues, onSetFilter, onClear }: DateFilterPanelProps) {
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    const activeValue = useMemo(() => {
        const arr = Array.from(activeValues);

        return arr[0] ?? null;
    }, [activeValues]);

    const handlePreset = useCallback(
        (value: string) => {
            setCalendarOpen(false);
            onSetFilter(value);
        },
        [onSetFilter],
    );

    const handleRangeSelect = useCallback(
        (range: DateRange | undefined) => {
            setDateRange(range);

            if (range?.from && range?.to) {
                const from = formatDateISO(range.from);
                const to = formatDateISO(range.to);

                onSetFilter(`${from}..${to}`);
                setCalendarOpen(false);
            }
        },
        [onSetFilter],
    );

    const handleClear = useCallback(() => {
        setDateRange(undefined);
        setCalendarOpen(false);
        onClear();
    }, [onClear]);

    return (
        <div className="flex flex-col">
            {/* Presets */}
            <div className="py-1">
                {DATE_PRESETS.map((preset) => {
                    const isActive = activeValue === preset.value;

                    return (
                        <button
                            key={preset.value}
                            type="button"
                            onClick={() => (isActive ? handleClear() : handlePreset(preset.value))}
                            className={cn('flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary', isActive && 'bg-primary/5')}
                        >
                            <div
                                className={cn(
                                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                    isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                                )}
                            >
                                {isActive && <Check className="size-2.5" />}
                            </div>
                            <span className="flex-1 text-left">{preset.label}</span>
                        </button>
                    );
                })}

                <div className="mx-3 my-1 border-t border-border" />

                {/* Custom range - nested Popover so calendar floats independently */}
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-secondary',
                                calendarOpen && 'bg-primary/5',
                            )}
                        >
                            <CalendarIcon className="size-4 text-muted-foreground" />
                            <span className="flex-1 text-left">Custom range</span>
                            {activeValue?.includes('..') && <span className="text-xs text-primary">{formatDateRangeDisplay(activeValue)}</span>}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="center" className="w-auto p-0">
                        <div className="p-2">
                            <Calendar mode="range" selected={dateRange} onSelect={handleRangeSelect} numberOfMonths={2} />
                            {dateRange?.from && dateRange?.to && (
                                <div className="flex items-center justify-between border-t border-border px-2 pt-2 mt-2">
                                    <span className="text-xs text-muted-foreground">
                                        {formatDateDisplay(dateRange.from)} - {formatDateDisplay(dateRange.to)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleClear}
                                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

function formatFacetName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
}

function formatDateDisplay(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRangeDisplay(raw: string): string {
    if (!raw.includes('..')) return raw;

    const [from, to] = raw.split('..');

    if (!from || !to) return raw;

    const fromDisplay = formatDateDisplay(new Date(from + 'T00:00:00'));
    const toDisplay = formatDateDisplay(new Date(to + 'T00:00:00'));

    if (from === to) return fromDisplay;

    return `${fromDisplay} – ${toDisplay}`;
}
