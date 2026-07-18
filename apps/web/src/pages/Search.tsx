import { HeaderActions } from '@/components/layout/Header';
import { FilterBar } from '@/components/search/filter-bar/FilterBar';
import { SearchResultsList } from '@/components/search/results/SearchResultsList';
import { EmptySearchState, NoQueryState } from '@/components/search/SearchEmptyStates';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useInfiniteSearch } from '@/lib/api/search';
import { useSearchQuery } from '@/lib/hooks/useSearchQuery';
import { cn } from '@/lib/utils';
import type { SearchResultView, SearchSortBy } from '@/routes/search';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDownAZ, ArrowUpAZ, Calendar, Check, ChevronDown, Clock, FileText, LayoutGrid, List, Search, Star, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const sortOptions: Array<{ value: SearchSortBy; label: string; icon: typeof Star }> = [
    { value: 'relevance', label: 'Relevance', icon: Star },
    { value: 'uploaded', label: 'Upload date', icon: Clock },
    { value: 'date', label: 'Document date', icon: Calendar },
    { value: 'filename', label: 'Filename', icon: ArrowDownAZ },
    { value: 'size', label: 'Size', icon: FileText },
];

const PHOTO_TYPES = new Set(['photo', 'screenshot']);
const PHOTO_CATEGORIES = new Set(['photo', 'screenshot', 'graphic']);

export function SearchPage() {
    const search = useSearchQuery();
    const navigate = useNavigate();
    const { q, freeText, sortBy, sortOrder } = search;
    const [localQuery, setLocalQuery] = useState(freeText);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const inputFocusedRef = useRef(false);

    const hasQuery = q.trim().length > 0;

    // Facets for the filter pills come from useSearchFacets (full-corpus, inside
    // FilterBar) — the result query itself skips them entirely
    const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteSearch(
        { q, sort_by: sortBy, sort_order: sortOrder, include_facets: false },
        hasQuery,
    );

    const results = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);
    const total = data?.pages[0]?.total ?? 0;

    // A photo-ish filter defaults the layout to the thumbnail grid
    const view: SearchResultView =
        search.view ??
        ((search.filterValues.get('type') ?? []).some((v) => PHOTO_TYPES.has(v)) ||
        (search.filterValues.get('category') ?? []).some((v) => PHOTO_CATEGORIES.has(v))
            ? 'grid'
            : 'list');

    // Sync the input when the URL changes (back nav, pill edits), but never mid-typing
    useEffect(() => {
        if (inputFocusedRef.current) return;

        setLocalQuery(freeText);
    }, [freeText]);

    // "/" focuses the search input
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;

            const target = e.target as HTMLElement;

            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            e.preventDefault();
            inputRef.current?.focus();
        };

        document.addEventListener('keydown', handler);

        return () => document.removeEventListener('keydown', handler);
    }, []);

    const handleQueryChange = useCallback(
        (value: string) => {
            setLocalQuery(value);
            clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => search.commitFreeText(value), 300);
        },
        [search.commitFreeText],
    );

    const handleClearQuery = useCallback(() => {
        setLocalQuery('');
        clearTimeout(debounceRef.current);
        search.setQuery('');
        inputRef.current?.focus();
    }, [search.setQuery]);

    const openDocument = useCallback((id: string) => navigate({ to: '/document/$id', params: { id } }), [navigate]);
    const openCollection = useCallback((id: string) => navigate({ to: '/browse/$sectionId', params: { sectionId: id } }), [navigate]);

    const isEmpty = hasQuery && !isLoading && !isFetching && results.length === 0;
    const activeSortOption = sortOptions.find((o) => o.value === sortBy);

    return (
        <div className="flex flex-1 flex-col">
            {/* Search shell: input + filter pills + meta, one sticky glass block */}
            <div className="sticky top-0 z-30 border-b border-border/40 bg-background/80 backdrop-blur-xl">
                <div className="mx-auto max-w-4xl px-4 pb-2 pt-2 md:px-6">
                    {/* On desktop this row IS the app header — Header.tsx skips its own bar on /search */}
                    <div className="mb-2 flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                ref={inputRef}
                                type="text"
                                value={localQuery}
                                onChange={(e) => handleQueryChange(e.target.value)}
                                onFocus={() => {
                                    inputFocusedRef.current = true;
                                }}
                                onBlur={() => {
                                    inputFocusedRef.current = false;
                                    setLocalQuery(freeText);
                                }}
                                placeholder="Search documents..."
                                className="h-12 rounded-xl border-border/50 bg-card/80 pl-11 pr-10 text-base shadow-sm focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-card/80"
                            />
                            {q && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClearQuery}
                                    className="absolute right-2 top-1/2 size-8 -translate-y-1/2 text-muted-foreground"
                                >
                                    <X className="size-3.5" />
                                </Button>
                            )}
                        </div>

                        <div className="hidden md:block">
                            <HeaderActions />
                        </div>
                    </div>

                    <FilterBar search={search} total={total} />

                    {/* Meta row: count echo left, sort + view right */}
                    <div className="mt-2 flex h-7 items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm text-muted-foreground">
                            {hasQuery && !isLoading && (
                                <>
                                    {total.toLocaleString()} result{total === 1 ? '' : 's'}
                                    {freeText && (
                                        <>
                                            {' for '}
                                            <span className="font-medium text-foreground">“{freeText}”</span>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary"
                                    >
                                        {activeSortOption && <activeSortOption.icon className="size-3.5" />}
                                        {activeSortOption?.label ?? 'Sort'}
                                        {sortOrder === 'asc' ? <ArrowUpAZ className="size-3" /> : <ChevronDown className="size-3" />}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                    {sortOptions.map((option) => (
                                        <DropdownMenuItem
                                            key={option.value}
                                            onClick={() => search.setSort(option.value)}
                                            className={cn(sortBy === option.value && 'font-medium')}
                                        >
                                            <option.icon className="size-3.5" />
                                            {option.label}
                                            {sortBy === option.value && <Check className="ml-auto size-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* List / grid toggle */}
                            <div className="flex rounded-md border border-border/60 p-0.5">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-label="List view"
                                    onClick={() => search.setView('list')}
                                    className={cn(
                                        'size-6 rounded-[5px] p-0 text-muted-foreground hover:bg-secondary dark:hover:bg-secondary',
                                        view === 'list' && 'bg-secondary text-foreground',
                                    )}
                                >
                                    <List className="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-label="Grid view"
                                    onClick={() => search.setView('grid')}
                                    className={cn(
                                        'size-6 rounded-[5px] p-0 text-muted-foreground hover:bg-secondary dark:hover:bg-secondary',
                                        view === 'grid' && 'bg-secondary text-foreground',
                                    )}
                                >
                                    <LayoutGrid className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Results */}
            <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-4 md:px-6">
                {hasQuery && (
                    <SearchResultsList
                        results={results}
                        view={view}
                        sortBy={sortBy}
                        isLoading={isLoading}
                        hasNextPage={hasNextPage ?? false}
                        isFetchingNextPage={isFetchingNextPage}
                        fetchNextPage={fetchNextPage}
                        onOpenDocument={openDocument}
                        onOpenCollection={openCollection}
                        onFolderClick={openCollection}
                    />
                )}

                {isEmpty && (
                    <EmptySearchState
                        freeText={freeText}
                        tokens={search.tokens}
                        onRemoveToken={search.removeToken}
                        onClearFilters={search.clearAllFilters}
                        onSearch={search.setQuery}
                    />
                )}

                {!hasQuery && <NoQueryState onSearch={search.setQuery} />}
            </div>
        </div>
    );
}
