import { SearchCommandPalette } from '@/components/search/SearchCommandPalette';
import { SearchFilterPopover } from '@/components/search/SearchFilterPopover';
import { ActiveFilters } from '@/components/search/SearchFilters';
import { SearchResultItem } from '@/components/search/SearchResultItem';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteSearch } from '@/lib/api/search';
import { cn } from '@/lib/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDownAZ, ArrowUpAZ, Calendar, ChevronDown, Clock, FileText, Loader2, Search, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SortBy = 'relevance' | 'uploaded' | 'date' | 'filename' | 'size';

const sortOptions: Array<{ value: SortBy; label: string; icon: typeof Star }> = [
    { value: 'relevance', label: 'Relevance', icon: Star },
    { value: 'uploaded', label: 'Upload date', icon: Clock },
    { value: 'date', label: 'Document date', icon: Calendar },
    { value: 'filename', label: 'Filename', icon: ArrowDownAZ },
    { value: 'size', label: 'Size', icon: FileText },
];

export function SearchPage() {
    const { q, sort_by, sort_order } = useSearch({ from: '/search' });
    const navigate = useNavigate();
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const sortMenuRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<HTMLDivElement>(null);

    const sortBy = (sort_by as SortBy) || 'relevance';
    const sortOrder = (sort_order as 'asc' | 'desc') || 'desc';

    const updateSearch = useCallback(
        (updates: { q?: string; sort_by?: string; sort_order?: string }) => {
            navigate({
                to: '/search',
                search: {
                    q: updates.q ?? q,
                    sort_by: updates.sort_by ?? sort_by,
                    sort_order: updates.sort_order ?? sort_order,
                },
                replace: true,
            });
        },
        [navigate, q, sort_by, sort_order],
    );

    const handleRemoveFilter = useCallback(
        (filter: { label: string }) => {
            const newQuery = q.replace(filter.label, '').replace(/\s+/g, ' ').trim();
            updateSearch({ q: newQuery });
        },
        [q, updateSearch],
    );

    const handleClearFilters = useCallback(() => {
        const freeText = q
            .replace(/-?\w+:(?:"[^"]*"|\S+)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        updateSearch({ q: freeText || '' });
    }, [q, updateSearch]);

    const handleAddFilter = useCallback(
        (filter: string) => {
            if (q.includes(filter)) return;

            updateSearch({ q: `${q} ${filter}`.trim() });
        },
        [q, updateSearch],
    );

    const handleRemoveFilterRaw = useCallback(
        (filter: string) => {
            updateSearch({ q: q.replace(filter, '').replace(/\s+/g, ' ').trim() });
        },
        [q, updateSearch],
    );

    const handleReplaceFilter = useCallback(
        (prefix: string, newValue: string) => {
            const filterRegex = new RegExp(`${prefix}:(?:"[^"]*"|\\S+)`, 'g');
            const cleaned = q.replace(filterRegex, '').replace(/\s+/g, ' ').trim();

            updateSearch({ q: `${cleaned} ${prefix}:${newValue}`.trim() });
        },
        [q, updateSearch],
    );

    const handleSort = useCallback(
        (newSortBy: SortBy) => {
            if (newSortBy === sortBy) {
                updateSearch({ sort_order: sortOrder === 'asc' ? 'desc' : 'asc' });
            } else {
                updateSearch({ sort_by: newSortBy, sort_order: 'desc' });
            }

            setShowSortMenu(false);
        },
        [sortBy, sortOrder, updateSearch],
    );

    const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteSearch({
        q,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_facets: true,
    });

    const results = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);
    const total = data?.pages[0]?.total ?? 0;
    const facets = data?.pages[0]?.facets;

    useEffect(() => {
        if (!observerRef.current || !hasNextPage) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { rootMargin: '200px' },
        );

        observer.observe(observerRef.current);

        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        if (!showSortMenu) return;

        const handler = (e: MouseEvent) => {
            if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
                setShowSortMenu(false);
            }
        };

        document.addEventListener('mousedown', handler);

        return () => document.removeEventListener('mousedown', handler);
    }, [showSortMenu]);

    const isEmpty = !isLoading && results.length === 0 && q.length > 0;
    const activeSortOption = sortOptions.find((o) => o.value === sortBy);

    return (
        <div className="flex flex-1 flex-col">
            {/* Search Header */}
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
                <div className="mx-auto max-w-4xl px-4 py-3 md:px-6">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                            {/* Query display -- click to open palette */}
                            <button
                                type="button"
                                onClick={() => setPaletteOpen(true)}
                                className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-secondary"
                            >
                                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate font-medium">{q || 'Search documents...'}</span>
                            </button>

                            {!isLoading && q && (
                                <span className="shrink-0 text-sm text-muted-foreground">
                                    {total.toLocaleString()} result{total !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {/* Sort Dropdown */}
                            <div className="relative" ref={sortMenuRef}>
                                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowSortMenu(!showSortMenu)}>
                                    {activeSortOption && <activeSortOption.icon className="size-3.5" />}
                                    {activeSortOption?.label ?? 'Sort'}
                                    {sortOrder === 'asc' ? <ArrowUpAZ className="size-3" /> : <ChevronDown className="size-3" />}
                                </Button>
                                {showSortMenu && (
                                    <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
                                        {sortOptions.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleSort(option.value)}
                                                className={cn(
                                                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                                                    sortBy === option.value ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-secondary',
                                                )}
                                            >
                                                <option.icon className="size-3.5" />
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Filter Popover */}
                            <SearchFilterPopover
                                currentQuery={q}
                                facets={facets}
                                onAddFilter={handleAddFilter}
                                onRemoveFilter={handleRemoveFilterRaw}
                                onReplaceFilter={handleReplaceFilter}
                            />
                        </div>
                    </div>

                    {/* Active filter chips */}
                    <ActiveFilters query={q} onRemoveFilter={handleRemoveFilter} onClearAll={handleClearFilters} />
                </div>
            </div>

            {/* Results */}
            <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6">
                {isLoading && (
                    <div className="space-y-2">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <SearchResultSkeleton key={i} />
                        ))}
                    </div>
                )}

                {!isLoading && results.length > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1">
                        {results.map((result, index) => (
                            <motion.div
                                key={result.document_id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                            >
                                <SearchResultItem
                                    result={result}
                                    onClick={() =>
                                        navigate({
                                            to: '/document/$id',
                                            params: { id: result.document_id },
                                        })
                                    }
                                />
                            </motion.div>
                        ))}
                    </motion.div>
                )}

                {hasNextPage && (
                    <div ref={observerRef} className="flex justify-center py-6">
                        {isFetchingNextPage && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
                    </div>
                )}

                {isEmpty && <EmptySearchState query={q} />}

                {!q && !isLoading && <NoQueryState />}
            </div>

            {/* Command palette for editing the query */}
            <SearchCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} initialQuery={q} />
        </div>
    );
}

function SearchResultSkeleton() {
    return (
        <div className="flex items-start gap-3 rounded-md px-3 py-2.5">
            <Skeleton className="size-10 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-sm" />
                <div className="flex gap-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                </div>
            </div>
        </div>
    );
}

function EmptySearchState({ query }: { query: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-4 size-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">No results for &ldquo;{query}&rdquo;</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Try different keywords, check for typos, or use filters like <code className="rounded bg-muted px-1 py-0.5 text-xs">type:photo</code> or{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">folder:receipts</code>
            </p>
        </div>
    );
}

function NoQueryState() {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-4 size-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">Search your documents</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Search by content, filename, tags, or use advanced filters</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                    { label: 'type:photo', desc: 'All photos' },
                    { label: 'format:pdf', desc: 'PDF files' },
                    { label: 'uploaded:last-week', desc: 'Recent uploads' },
                    { label: 'has:summary', desc: 'With AI summary' },
                ].map((example) => (
                    <div key={example.label} className="rounded-lg border border-border bg-card px-3 py-2 text-left">
                        <code className="text-xs font-medium text-primary">{example.label}</code>
                        <p className="mt-0.5 text-xs text-muted-foreground">{example.desc}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
