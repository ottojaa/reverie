import { SearchFilterPopover } from '@/components/search/SearchFilterPopover';
import { ActiveFilters } from '@/components/search/SearchFilters';
import { SearchResultItem } from '@/components/search/SearchResultItem';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteSearch } from '@/lib/api/search';
import { cn } from '@/lib/utils';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDownAZ, ArrowUpAZ, Calendar, Check, ChevronDown, Clock, FileText, FolderSearch2, Image, Loader2, Search, Star, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SortBy = 'relevance' | 'uploaded' | 'date' | 'filename' | 'size';

const SKELETON_DELAY_MS = 200;

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
    const [localQuery, setLocalQuery] = useState(q);
    const [showSkeleton, setShowSkeleton] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const observerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const sortBy = (sort_by as SortBy) || 'relevance';
    const sortOrder = (sort_order as 'asc' | 'desc') || 'desc';

    const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteSearch({
        q,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_facets: true,
    });

    const results = useMemo(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);
    const total = data?.pages[0]?.total ?? 0;
    const facets = data?.pages[0]?.facets;

    // Sync local query when URL changes (e.g., navigating back)
    useEffect(() => {
        setLocalQuery(q);
    }, [q]);

    // Keyboard shortcut: "/" to focus search input
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.target as HTMLElement;

                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        document.addEventListener('keydown', handler);

        return () => document.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        if (!isLoading) {
            setShowSkeleton(false);

            return;
        }

        const t = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);

        return () => clearTimeout(t);
    }, [isLoading]);

    const handleQueryChange = useCallback(
        (value: string) => {
            setLocalQuery(value);
            clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                navigate({
                    to: '/search',
                    search: { q: value, sort_by: sort_by ?? 'relevance', sort_order: sort_order ?? 'desc' },
                    replace: true,
                });
            }, 300);
        },
        [navigate, sort_by, sort_order],
    );

    const handleClearQuery = useCallback(() => {
        setLocalQuery('');
        clearTimeout(debounceRef.current);
        navigate({ to: '/search', search: { q: '', sort_by: sort_by ?? 'relevance', sort_order: sort_order ?? 'desc' }, replace: true });
        inputRef.current?.focus();
    }, [navigate, sort_by, sort_order]);

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
        },
        [sortBy, sortOrder, updateSearch],
    );

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

    const isEmpty = !isLoading && results.length === 0 && q.length > 0;
    const activeSortOption = sortOptions.find((o) => o.value === sortBy);

    return (
        <div className="flex flex-1 flex-col">
            {/* Search Header */}
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
                <div className="mx-auto max-w-4xl px-4 py-3 md:px-6">
                    {/* Row 1: Search input (full width) */}
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={inputRef}
                            type="text"
                            value={localQuery}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            placeholder="Search documents..."
                            className="h-11 rounded-lg pl-10 pr-9"
                        />
                        {localQuery && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={handleClearQuery}
                                className="absolute right-3 top-1/2 -translate-y-1/2 size-8"
                            >
                                <X className="size-3.5" />
                            </Button>
                        )}
                    </div>

                    {/* Row 2: Result count + sort/filter controls */}
                    <div className="mt-2 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                            {!isLoading && q && (
                                <span>
                                    {total.toLocaleString()} result{total !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {/* Sort Dropdown */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                                        {activeSortOption && <activeSortOption.icon className="size-3.5" />}
                                        {activeSortOption?.label ?? 'Sort'}
                                        {sortOrder === 'asc' ? <ArrowUpAZ className="size-3" /> : <ChevronDown className="size-3" />}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                    {sortOptions.map((option) => (
                                        <DropdownMenuItem
                                            key={option.value}
                                            onClick={() => handleSort(option.value)}
                                            className={cn(sortBy === option.value && 'font-medium')}
                                        >
                                            <option.icon className="size-3.5" />
                                            {option.label}
                                            {sortBy === option.value && <Check className="ml-auto size-3.5 text-primary" />}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

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

                    {/* Row 3: Active filter chips */}
                    <ActiveFilters query={q} onRemoveFilter={handleRemoveFilter} onClearAll={handleClearFilters} />
                </div>
            </div>

            {/* Results */}
            <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6">
                {isLoading && (
                    <div className="space-y-2">
                        {Array.from({ length: 8 }).map((_, i) =>
                            showSkeleton ? (
                                <SearchResultSkeleton key={i} />
                            ) : (
                                <div key={i} className="opacity-0 pointer-events-none" aria-hidden>
                                    <SearchResultSkeleton />
                                </div>
                            ),
                        )}
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

                {!q && !isLoading && <NoQueryState onFilter={(filter) => handleQueryChange(filter)} />}
            </div>
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

const QUICK_FILTERS = [
    { query: 'category:photo', label: 'All photos', icon: Image },
    { query: 'format:pdf', label: 'PDF files', icon: FileText },
    { query: 'uploaded:last-week', label: 'Recent uploads', icon: Clock },
    { query: 'has:summary', label: 'With AI summary', icon: Star },
];

function NoQueryState({ onFilter }: { onFilter: (query: string) => void }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
            <FolderSearch2 className="size-20 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">Find your documents</h3>
            <p className="mb-3 text-xs font-medium text-muted-foreground">Try one of these quick filters:</p>
            <div className="flex flex-wrap justify-center gap-2">
                {QUICK_FILTERS.map((filter) => (
                    <Button
                        key={filter.query}
                        type="button"
                        variant="outline"
                        onClick={() => onFilter(filter.query)}
                        className="gap-2"
                    >
                        <filter.icon className="size-4 text-muted-foreground" />
                        {filter.label}
                    </Button>
                ))}
            </div>
        </div>
    );
}
