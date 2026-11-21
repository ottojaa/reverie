import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api/admin';
import { getApiErrorMessage } from '@/lib/api/client';
import type { EmbeddingStatusResponse } from '@reverie/shared';
import { useQuery } from '@tanstack/react-query';

type Counts = EmbeddingStatusResponse['text'];

function toPercent({ eligible, embedded }: Counts): number {
    if (eligible === 0) return 100;

    return Math.min(100, Math.floor((embedded / eligible) * 100));
}

function describeMl(ml: EmbeddingStatusResponse['ml']): { label: string; variant: 'secondary' | 'destructive' | 'outline' } {
    if (ml.ready) return { label: 'Ready' + (ml.device ? ' (' + ml.device + ')' : ''), variant: 'secondary' };

    if (ml.reachable) return { label: ml.error ? 'Failed to load models' : 'Loading models', variant: ml.error ? 'destructive' : 'outline' };

    return { label: 'Unreachable', variant: 'destructive' };
}

function CountsRow({ label, counts }: { label: string; counts: Counts }) {
    const percent = toPercent(counts);

    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground tabular-nums">
                    {counts.embedded.toLocaleString()} of {counts.eligible.toLocaleString()}
                </span>
            </div>
            <Progress value={percent} aria-label={label + ' embedded'} />
        </div>
    );
}

function modelLabel(model: EmbeddingStatusResponse['ml']['text']): string {
    return model ? model.name + ' · ' + model.dimensions + '-d' : 'not loaded';
}

function StatusBody({ status }: { status: EmbeddingStatusResponse }) {
    if (!status.enabled) {
        return <p className="p-5 text-sm text-muted-foreground">Embeddings are off: set ML_URL on the backend to turn them on.</p>;
    }

    const ml = describeMl(status.ml);

    return (
        <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant={ml.variant}>{ml.label}</Badge>
                <Badge variant="outline">{status.backfill === 'running' ? 'Backfill running' : 'Backfill done'}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="min-w-0">
                    <dt className="inline">Text: </dt>
                    <dd className="inline break-all">{modelLabel(status.ml.text)}</dd>
                </div>
                <div className="min-w-0">
                    <dt className="inline">Images: </dt>
                    <dd className="inline break-all">{modelLabel(status.ml.image)}</dd>
                </div>
            </dl>
            <CountsRow label="Documents with text" counts={status.text} />
            <CountsRow label="Images" counts={status.image} />
            <p className="text-xs text-muted-foreground tabular-nums">
                Queue: {status.queue.active} active, {status.queue.waiting} waiting, {status.queue.delayed} retrying, {status.queue.failed} failed
            </p>
        </div>
    );
}

/** Read-only view of the local embedding pipeline; refreshes while the page is open. */
export function EmbeddingStatusCard({ enabled }: { enabled: boolean }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'embeddings'],
        queryFn: () => adminApi.getEmbeddingStatus(),
        enabled,
        refetchInterval: 10_000,
    });

    return (
        <section aria-labelledby="embedding-status-title" className="mt-8">
            <h2 id="embedding-status-title" className="text-lg font-semibold tracking-tight">
                Embeddings
            </h2>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">Local models index every document and image for semantic search. Read-only.</p>
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                {isLoading && (
                    <div className="space-y-4 p-5">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                )}
                {error && <p className="p-5 text-sm text-destructive">{getApiErrorMessage(error, 'Failed to load embedding status')}</p>}
                {data && <StatusBody status={data} />}
            </div>
        </section>
    );
}
