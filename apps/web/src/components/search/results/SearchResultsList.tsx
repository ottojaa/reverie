import { Skeleton } from '@/components/ui/skeleton';
import type { SearchResultView, SearchSortBy } from '@/routes/search';
import type { SearchHit } from '@reverie/shared';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CollectionResultItem } from '../CollectionResultItem';
import { SearchResultItem } from '../SearchResultItem';
import { PhotoResultGrid } from './PhotoResultGrid';

const SKELETON_DELAY_MS = 200;
const EASE = [0.22, 1, 0.36, 1] as const;

interface SearchResultsListProps {
    results: SearchHit[];
    view: SearchResultView;
    sortBy: SearchSortBy;
    isLoading: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => void;
    onOpenDocument: (id: string) => void;
    onOpenCollection: (id: string) => void;
    onFolderClick: (folderId: string) => void;
}

interface ResultBucket {
    label: string | null;
    items: Array<{ hit: SearchHit; index: number }>;
}

function getDateBucket(iso: string, now: Date): string {
    const date = new Date(iso);
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000);

    if (diffDays < 0) return date.getFullYear() === now.getFullYear() ? 'Today' : String(date.getFullYear());

    if (diffDays === 0) return 'Today';

    if (diffDays === 1) return 'Yesterday';

    if (diffDays < 7) return 'This week';

    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'This month';

    if (date.getFullYear() === now.getFullYear()) return 'This year';

    return String(date.getFullYear());
}

/** Date-bucket headers only make sense for date sorts over documents-only pages. */
function toBuckets(results: SearchHit[], sortBy: SearchSortBy): ResultBucket[] {
    const indexed = results.map((hit, index) => ({ hit, index }));
    const isDateSort = sortBy === 'uploaded' || sortBy === 'date';
    const documentsOnly = results.every((hit) => hit.result_type === 'document');

    if (!isDateSort || !documentsOnly) return [{ label: null, items: indexed }];

    const now = new Date();
    const buckets: ResultBucket[] = [];

    for (const item of indexed) {
        if (item.hit.result_type !== 'document') continue;

        const iso = sortBy === 'date' ? (item.hit.extracted_date ?? item.hit.uploaded_at) : item.hit.uploaded_at;
        const label = getDateBucket(iso, now);
        const current = buckets.at(-1);

        if (current && current.label === label) {
            current.items.push(item);
            continue;
        }

        buckets.push({ label, items: [item] });
    }

    return buckets;
}

function ListRowSkeleton() {
    return (
        <div className="flex items-start gap-3 rounded-lg px-3 py-2.5">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-sm" />
                <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
        </div>
    );
}

function GridTileSkeleton() {
    return <Skeleton className="aspect-square rounded-lg" />;
}

function ResultsSkeleton({ view, visible }: { view: SearchResultView; visible: boolean }) {
    const wrapper = visible ? '' : 'pointer-events-none opacity-0';

    if (view === 'grid') {
        return (
            <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${wrapper}`} aria-hidden={!visible}>
                {Array.from({ length: 10 }).map((_, i) => (
                    <GridTileSkeleton key={i} />
                ))}
            </div>
        );
    }

    return (
        <div className={`space-y-0.5 ${wrapper}`} aria-hidden={!visible}>
            {Array.from({ length: 8 }).map((_, i) => (
                <ListRowSkeleton key={i} />
            ))}
        </div>
    );
}

/** The scrolling result surface: list/grid views, date-bucket headers, staggered entrance, infinite scroll. */
export function SearchResultsList({
    results,
    view,
    sortBy,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    onOpenDocument,
    onOpenCollection,
    onFolderClick,
}: SearchResultsListProps) {
    const observerRef = useRef<HTMLDivElement>(null);
    const [showSkeleton, setShowSkeleton] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setShowSkeleton(false);

            return;
        }

        const t = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);

        return () => clearTimeout(t);
    }, [isLoading]);

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

    const buckets = useMemo(() => toBuckets(results, sortBy), [results, sortBy]);

    if (isLoading) return <ResultsSkeleton view={view} visible={showSkeleton} />;

    if (results.length === 0) return null;

    return (
        <>
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={view}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: EASE }}
                    className="space-y-4"
                >
                    {buckets.map((bucket) => (
                        <div key={bucket.label ?? 'all'}>
                            {bucket.label && (
                                <div className="px-3 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{bucket.label}</div>
                            )}

                            {view === 'grid' ? (
                                <PhotoResultGrid
                                    results={bucket.items.map((item) => item.hit)}
                                    onOpenDocument={onOpenDocument}
                                    onOpenCollection={onOpenCollection}
                                />
                            ) : (
                                <div className="space-y-0.5">
                                    {bucket.items.map(({ hit, index }) => (
                                        <motion.div
                                            key={hit.result_type === 'collection' ? `col-${hit.id}` : `doc-${hit.document_id}`}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.2, ease: EASE }}
                                        >
                                            {hit.result_type === 'collection' ? (
                                                <CollectionResultItem result={hit} onClick={() => onOpenCollection(hit.id)} />
                                            ) : (
                                                <SearchResultItem result={hit} onClick={() => onOpenDocument(hit.document_id)} onFolderClick={onFolderClick} />
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </motion.div>
            </AnimatePresence>

            {hasNextPage && (
                <div ref={observerRef} className="flex justify-center py-6">
                    {isFetchingNextPage && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
                </div>
            )}
        </>
    );
}
