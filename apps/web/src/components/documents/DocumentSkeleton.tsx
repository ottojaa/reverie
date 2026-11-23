import { Skeleton } from '@/components/ui/skeleton';

export function DocumentSkeleton() {
    return (
        <div className="overflow-hidden rounded-md border border-border/50 bg-card shadow-md">
            <Skeleton className="aspect-4/3 w-full rounded-none" />
            <div className="p-3">
                <Skeleton className="h-4 w-3/4" />
                <div className="mt-2 flex gap-2">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-3 w-3" />
                    <Skeleton className="h-3 w-16" />
                </div>
            </div>
        </div>
    );
}

/** Placeholder for the Files table while its first page loads. */
export function DocumentRowsSkeleton() {
    return (
        <div className="overflow-hidden rounded-xl bg-card">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex h-[52px] items-center gap-3 border-t border-border/60 px-4 first:border-t-0">
                    <Skeleton className="size-8 rounded-lg" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="ml-auto h-4 w-16" />
                    <Skeleton className="h-4 w-28" />
                </div>
            ))}
        </div>
    );
}
