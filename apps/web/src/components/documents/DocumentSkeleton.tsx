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
