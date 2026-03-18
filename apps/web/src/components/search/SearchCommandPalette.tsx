import { Button } from '@/components/ui/button';
import { useQuickFilters, useSearch, useSearchSuggestions } from '@/lib/api/search';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useSearchState } from '@/lib/hooks/useSearchState';
import { cn } from '@/lib/utils';
import type { SearchResult, SuggestionType } from '@reverie/shared';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { ArrowRight, Clock, FileText, Folder, HardDrive, Hash, Image, Loader2, MapPin, Search, Sparkles, Tag, TrendingUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SearchCommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialQuery?: string;
}

const quickFilterIcons: Record<string, typeof FileText> = {
    image: Image,
    'file-text': FileText,
    receipt: FileText,
    clock: Clock,
    'hard-drive': HardDrive,
    'trending-up': TrendingUp,
};

const suggestionTypeIcons: Record<SuggestionType, typeof FileText> = {
    filename: FileText,
    folder: Folder,
    tag: Tag,
    entity: Sparkles,
    category: Hash,
    location: MapPin,
};

const suggestionTypeLabels: Record<SuggestionType, string> = {
    filename: 'Files',
    folder: 'Folders',
    tag: 'Tags',
    entity: 'Entities',
    category: 'Categories',
    location: 'Locations',
};

const SUGGESTION_TYPES: SuggestionType[] = ['filename', 'folder', 'tag', 'category'];

export function SearchCommandPalette({ open, onOpenChange, initialQuery }: SearchCommandPaletteProps) {
    const navigate = useNavigate();
    const { query, debouncedQuery, setQuery, clearQuery, recentSearches, addRecentSearch, removeRecentSearch } = useSearchState(250);
    const inputRef = useRef<HTMLInputElement>(null);
    const [activeSuggestionType, setActiveSuggestionType] = useState<SuggestionType>('filename');

    const hasQuery = query.trim().length > 0;
    const hasDebounced = debouncedQuery.trim().length > 0;

    const { data: quickFilters } = useQuickFilters();

    const { data: suggestions, isLoading: suggestionsLoading } = useSearchSuggestions(activeSuggestionType, debouncedQuery, 5);

    const { data: previewResults, isLoading: searchLoading } = useSearch({ q: debouncedQuery, limit: 5, include_facets: false }, hasDebounced);

    const allSuggestionTypes = useMemo(() => {
        if (!hasDebounced) return [];

        return SUGGESTION_TYPES;
    }, [hasDebounced]);

    useEffect(() => {
        if (open) {
            setActiveSuggestionType('filename');

            if (initialQuery) {
                setQuery(initialQuery);
            }
        }
    }, [open]);

    const navigateToSearch = useCallback(
        (searchQuery: string) => {
            if (!searchQuery.trim()) return;

            onOpenChange(false);
            navigate({ to: '/search', search: { q: searchQuery, sort_by: 'relevance', sort_order: 'desc' } });
        },
        [navigate, onOpenChange],
    );

    const handleSubmit = useCallback(() => {
        if (!query.trim()) return;

        addRecentSearch(query.trim());
        navigateToSearch(query.trim());
    }, [query, addRecentSearch, navigateToSearch]);

    const handleQuickFilter = useCallback(
        (filterQuery: string) => {
            navigateToSearch(filterQuery);
        },
        [navigateToSearch],
    );

    const handleRecentSearch = useCallback(
        (recentQuery: string) => {
            setQuery(recentQuery);
            navigateToSearch(recentQuery);
        },
        [setQuery, navigateToSearch],
    );

    const handleSuggestionClick = useCallback(
        (suggestion: string, type: SuggestionType) => {
            const filterMap: Record<SuggestionType, string> = {
                filename: suggestion,
                folder: `folder:${suggestion}`,
                tag: `tag:${suggestion}`,
                entity: `entity:${suggestion}`,
                category: `category:${suggestion}`,
                location: `location:${suggestion}`,
            };
            const newQuery = type === 'filename' ? suggestion : `${query.trim()} ${filterMap[type]}`.trim();
            setQuery(newQuery);
            navigateToSearch(newQuery);
        },
        [query, setQuery, navigateToSearch],
    );

    const handleResultClick = useCallback(
        (documentId: string) => {
            if (query.trim()) {
                addRecentSearch(query.trim());
            }

            onOpenChange(false);
            navigate({ to: '/document/$id', params: { id: documentId } });
        },
        [query, addRecentSearch, onOpenChange, navigate],
    );

    const handleClose = useCallback(() => {
        onOpenChange(false);
        setTimeout(clearQuery, 200);
    }, [onOpenChange, clearQuery]);

    const isLoading = suggestionsLoading || searchLoading;

    return (
        <DialogPrimitive.Root open={open} onOpenChange={handleClose}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <DialogPrimitive.Content
                    className="fixed top-[min(20vh,140px)] left-1/2 z-50 w-full max-w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 duration-200"
                    aria-label="Search documents"
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        inputRef.current?.focus();
                    }}
                >
                    <Command className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl" shouldFilter={false} loop>
                        {/* Search Input */}
                        <div className="flex items-center gap-2 border-b border-border px-4">
                            <Search className="size-4 shrink-0 text-muted-foreground" />
                            <Command.Input
                                ref={inputRef}
                                value={query}
                                onValueChange={setQuery}
                                placeholder="Search documents, folders, tags..."
                                className="h-12 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground outline-none"
                            />
                            {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
                            {hasQuery && !isLoading && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => {
                                        clearQuery();
                                        inputRef.current?.focus();
                                    }}
                                    className="text-muted-foreground"
                                >
                                    <X className="size-3.5" />
                                </Button>
                            )}
                        </div>

                        {/* Content */}
                        <Command.List className="max-h-[min(50vh,400px)] overflow-y-auto overscroll-contain p-2">
                            <AnimatePresence mode="wait">
                                {!hasQuery ? (
                                    <EmptyState
                                        key="empty"
                                        recentSearches={recentSearches.slice(0, 5)}
                                        quickFilters={quickFilters ?? []}
                                        onRecentSearch={handleRecentSearch}
                                        onRemoveRecent={removeRecentSearch}
                                        onQuickFilter={handleQuickFilter}
                                    />
                                ) : (
                                    <SearchResults
                                        key="results"
                                        query={debouncedQuery}
                                        suggestions={suggestions ?? []}
                                        suggestionTypes={allSuggestionTypes}
                                        activeSuggestionType={activeSuggestionType}
                                        onSuggestionTypeChange={setActiveSuggestionType}
                                        onSuggestionClick={handleSuggestionClick}
                                        results={previewResults?.results ?? []}
                                        total={previewResults?.total ?? 0}
                                        timingMs={previewResults?.timing_ms}
                                        isLoading={searchLoading && !previewResults}
                                        onResultClick={handleResultClick}
                                        onViewAll={handleSubmit}
                                    />
                                )}
                            </AnimatePresence>
                        </Command.List>

                        {/* Footer */}
                        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                            <div className="hidden md:flex items-center gap-3">
                                <span className="flex items-center gap-1">
                                    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
                                    navigate
                                </span>
                                <span className="flex items-center gap-1">
                                    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
                                    select
                                </span>
                                <span className="flex items-center gap-1">
                                    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd>
                                    close
                                </span>
                            </div>
                        </div>
                    </Command>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/* ============================================================================
 * Empty State: Recent searches + Quick filters
 * ============================================================================ */

interface EmptyStateProps {
    recentSearches: Array<{ query: string }>;
    quickFilters: Array<{ label: string; query: string; icon?: string }>;
    onRecentSearch: (query: string) => void;
    onRemoveRecent: (query: string) => void;
    onQuickFilter: (query: string) => void;
}

function EmptyState({ recentSearches, quickFilters, onRecentSearch, onRemoveRecent, onQuickFilter }: EmptyStateProps) {
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {recentSearches.length > 0 && (
                <Command.Group heading={<span className="px-1 text-xs font-medium text-muted-foreground">Recent</span>}>
                    {recentSearches.map((recent) => (
                        <Command.Item
                            key={recent.query}
                            value={`recent-${recent.query}`}
                            onSelect={() => onRecentSearch(recent.query)}
                            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors aria-selected:bg-secondary data-[selected=true]:bg-secondary"
                        >
                            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{recent.query}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveRecent(recent.query);
                                }}
                                className="shrink-0 size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-data-[selected=true]:opacity-100 [div[aria-selected=true]>&]:opacity-100 hover:opacity-100"
                            >
                                <X className="size-3" />
                            </Button>
                        </Command.Item>
                    ))}
                </Command.Group>
            )}

            {quickFilters.length > 0 && (
                <Command.Group heading={<span className="px-1 text-xs font-medium text-muted-foreground">Quick Filters</span>}>
                    <div className="flex flex-wrap gap-1.5 px-1 py-1.5">
                        {quickFilters.map((filter) => {
                            const Icon = filter.icon ? (quickFilterIcons[filter.icon] ?? FileText) : FileText;

                            return (
                                <Button
                                    key={filter.query}
                                    type="button"
                                    variant="outline"
                                    onClick={() => onQuickFilter(filter.query)}
                                    className="rounded-full gap-1.5 px-3 py-1.5 text-xs"
                                >
                                    <Icon className="size-3 text-muted-foreground" />
                                    {filter.label}
                                </Button>
                            );
                        })}
                    </div>
                </Command.Group>
            )}

            {recentSearches.length === 0 && quickFilters.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                    <Search className="mx-auto mb-2 size-8 opacity-30" />
                    <p>Search your documents by content, filename, or metadata</p>
                    <p className="mt-1 text-xs">
                        Try <code className="rounded bg-muted px-1 py-0.5">type:photo</code> or{' '}
                        <code className="rounded bg-muted px-1 py-0.5">folder:receipts</code>
                    </p>
                </div>
            )}
        </motion.div>
    );
}

/* ============================================================================
 * Search Results: Suggestions + Preview results
 * ============================================================================ */

interface SearchResultsProps {
    query: string;
    suggestions: string[];
    suggestionTypes: SuggestionType[];
    activeSuggestionType: SuggestionType;
    onSuggestionTypeChange: (type: SuggestionType) => void;
    onSuggestionClick: (suggestion: string, type: SuggestionType) => void;
    results: SearchResult[];
    total: number;
    timingMs?: number;
    isLoading: boolean;
    onResultClick: (documentId: string) => void;
    onViewAll: () => void;
}

function SearchResults({
    query,
    suggestions,
    suggestionTypes,
    activeSuggestionType,
    onSuggestionTypeChange,
    onSuggestionClick,
    results,
    total,
    isLoading,
    onResultClick,
    onViewAll,
}: SearchResultsProps) {
    return (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            {/* Search action -- always first so bare Enter goes to search page */}
            {query.trim() && (
                <Command.Item
                    value="search-all"
                    onSelect={onViewAll}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors aria-selected:bg-secondary data-[selected=true]:bg-secondary"
                >
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                        Search for &ldquo;<span className="font-medium text-foreground">{query.trim()}</span>&rdquo;
                    </span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground opacity-0 [[aria-selected=true]>&]:opacity-100 [[data-selected=true]>&]:opacity-100" />
                </Command.Item>
            )}

            {/* Suggestions */}
            {suggestionTypes.length > 0 && suggestions.length > 0 && (
                <Command.Group>
                    <div className="mb-1.5 flex items-center gap-0.5 border-b border-border px-1">
                        {suggestionTypes.map((type) => {
                            const Icon = suggestionTypeIcons[type];
                            const isActive = activeSuggestionType === type;

                            return (
                                <Button
                                    key={type}
                                    type="button"
                                    variant="ghost"
                                    onClick={() => onSuggestionTypeChange(type)}
                                    className={cn(
                                        'relative h-auto gap-1 px-2.5 pb-2 pt-1 text-xs font-medium',
                                        isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icon className="size-3" />
                                    {suggestionTypeLabels[type]}
                                    {isActive && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />}
                                </Button>
                            );
                        })}
                    </div>
                    {suggestions.map((suggestion) => (
                        <Command.Item
                            key={`sug-${activeSuggestionType}-${suggestion}`}
                            value={`suggestion-${suggestion}`}
                            onSelect={() => onSuggestionClick(suggestion, activeSuggestionType)}
                            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors aria-selected:bg-secondary data-[selected=true]:bg-secondary"
                        >
                            {(() => {
                                const Icon = suggestionTypeIcons[activeSuggestionType];

                                return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
                            })()}
                            <span className="min-w-0 flex-1 truncate">{suggestion}</span>
                            <ArrowRight className="size-3 shrink-0 text-muted-foreground opacity-0 [[aria-selected=true]>&]:opacity-100 [[data-selected=true]>&]:opacity-100" />
                        </Command.Item>
                    ))}
                </Command.Group>
            )}

            {/* Preview Results */}
            {results.length > 0 && (
                <Command.Group
                    heading={
                        <span className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                            <span>Results</span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-primary">{total.toLocaleString()} found</span>
                        </span>
                    }
                    className="mt-1"
                >
                    {results.map((result) => (
                        <PreviewResultItem key={result.document_id} result={result} onSelect={() => onResultClick(result.document_id)} />
                    ))}
                </Command.Group>
            )}

            {/* Loading */}
            {isLoading && results.length === 0 && (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* No results */}
            {!isLoading && results.length === 0 && suggestions.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                    <Search className="mx-auto mb-2 size-6 opacity-30" />
                    <p>No results found</p>
                    <p className="mt-1 text-xs">Try different keywords or filters</p>
                </div>
            )}
        </motion.div>
    );
}

/* ============================================================================
 * Lightweight result row for the overlay (name + thumbnail only)
 * ============================================================================ */

const resultCategoryIcons: Record<string, typeof FileText> = {
    photo: Image,
    screenshot: Image,
    graphic: Image,
};

function PreviewResultItem({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
    const categoryIcon = result.category ? resultCategoryIcons[result.category] : undefined;
    const Icon = categoryIcon ?? (result.mime_type.startsWith('image/') ? Image : FileText);
    const thumbnailUrl = getThumbnailUrl(result, 'sm');
    const displayName = result.display_name ?? result.filename;

    return (
        <Command.Item
            value={`result-${result.document_id}`}
            onSelect={onSelect}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors aria-selected:bg-secondary data-[selected=true]:bg-secondary"
        >
            {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="" className="size-7 shrink-0 rounded object-cover bg-muted" />
            ) : (
                <div className="flex size-7 shrink-0 items-center justify-center rounded bg-muted">
                    <Icon className="size-3.5 text-muted-foreground" />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <span className="block truncate">{displayName}</span>
                {result.snippet && (
                    <p
                        className="truncate text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                )}
            </div>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground opacity-0 [[aria-selected=true]>&]:opacity-100 [[data-selected=true]>&]:opacity-100" />
        </Command.Item>
    );
}
