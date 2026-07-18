import { Button } from '@/components/ui/button';
import { useSearchState } from '@/lib/hooks/useSearchState';
import { formatFilterChip, isKnownFilter, type QueryToken } from '@reverie/shared';
import { Clock, FolderSearch2, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { QuickFilterChips } from './QuickFilterChips';

const EASE = [0.22, 1, 0.36, 1] as const;
const MAX_RECENT_ROWS = 5;

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</div>;
}

function tokenLabel(token: QueryToken): string {
    const key = token.negated && token.key === 'has' ? '-has' : (token.key ?? '');
    const label = formatFilterChip(key, token.value);

    return token.negated && token.key !== 'has' ? `Not ${label}` : label;
}

interface NoQueryStateProps {
    onSearch: (query: string) => void;
}

/** Browse start for an empty query: quick filters with live counts + recent searches. */
export function NoQueryState({ onSearch }: NoQueryStateProps) {
    const { recentSearches, removeRecentSearch } = useSearchState();
    const recent = recentSearches.slice(0, MAX_RECENT_ROWS);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="mx-auto flex w-full max-w-md flex-col items-center gap-2 py-14"
        >
            <FolderSearch2 className="mb-1 size-14 text-muted-foreground/25" />
            <h3 className="text-base font-medium">Find your documents</h3>
            <p className="mb-5 text-sm text-muted-foreground">Search by keyword, or jump straight in:</p>

            <div className="w-full space-y-2">
                <MicroLabel>Quick filters</MicroLabel>
                <QuickFilterChips onSelect={onSearch} staggered className="flex flex-wrap gap-1.5" />
            </div>

            {recent.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.25, ease: EASE }}
                    className="mt-6 w-full space-y-1"
                >
                    <MicroLabel>Recent</MicroLabel>
                    {recent.map((entry) => (
                        <div key={entry.query} className="group flex items-center">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => onSearch(entry.query)}
                                className="h-auto min-w-0 flex-1 justify-start gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary"
                            >
                                <Clock className="size-3.5 shrink-0" />
                                <span className="min-w-0 truncate text-left">{entry.query}</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Remove recent search"
                                onClick={() => removeRecentSearch(entry.query)}
                                className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                            >
                                <X className="size-3" />
                            </Button>
                        </div>
                    ))}
                </motion.div>
            )}
        </motion.div>
    );
}

interface EmptySearchStateProps {
    freeText: string;
    tokens: QueryToken[];
    onRemoveToken: (token: QueryToken) => void;
    onClearFilters: () => void;
    onSearch: (query: string) => void;
}

/** Zero results: name the culprit filters with one-click removal instead of a shrug. */
export function EmptySearchState({ freeText, tokens, onRemoveToken, onClearFilters, onSearch }: EmptySearchStateProps) {
    const filterTokens = tokens.filter(isKnownFilter);
    const hasFilters = filterTokens.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="mx-auto flex w-full max-w-md flex-col items-center py-16 text-center"
        >
            <Search className="mb-4 size-10 text-muted-foreground/25" />
            <h3 className="text-base font-medium">{freeText ? `No results for “${freeText}”` : 'Nothing matches these filters'}</h3>

            {hasFilters ? (
                <>
                    <p className="mb-5 mt-1.5 text-sm text-muted-foreground">Loosen the search by removing a filter:</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                        {filterTokens.map((token) => (
                            <Button
                                key={token.raw + token.value}
                                type="button"
                                variant="outline"
                                onClick={() => onRemoveToken(token)}
                                className="h-8 gap-1.5 rounded-full px-3 text-xs transition-colors hover:border-primary/50 hover:bg-secondary hover:text-primary"
                            >
                                <X className="size-3 text-muted-foreground" />
                                {tokenLabel(token)}
                            </Button>
                        ))}
                        {filterTokens.length > 1 && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClearFilters}
                                className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Clear all filters
                            </Button>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <p className="mb-5 mt-1.5 text-sm text-muted-foreground">Try different keywords, or browse with a filter:</p>
                    <QuickFilterChips onSelect={onSearch} staggered className="flex flex-wrap justify-center gap-1.5" />
                </>
            )}
        </motion.div>
    );
}
