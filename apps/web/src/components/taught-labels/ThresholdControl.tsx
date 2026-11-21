import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useSetLabelThreshold, useTaughtLabelSimilarities } from '@/lib/api/taught-labels';
import { countAtLeast, formatImageCount, formatThreshold } from '@/lib/taught-labels';
import type { TaughtLabel } from '@reverie/shared';
import { useMemo, useState } from 'react';

const MIN_THRESHOLD = 0.5;
const STEP = 0.01;

/**
 * How close an image must look to an example to get the label. Moving the slider recounts instantly from the
 * similarities the server listed (the count equals what applying will do); Apply saves it and relabels.
 * Mount with `key` = label id + saved threshold so the draft restarts when the saved value changes.
 */
export function ThresholdControl({ label }: { label: TaughtLabel }) {
    const [draft, setDraft] = useState(label.threshold);
    const { data, isLoading } = useTaughtLabelSimilarities(label.id);
    const setThreshold = useSetLabelThreshold();
    const wouldMatch = useMemo(() => (data ? countAtLeast(data.similarities, draft) : null), [data, draft]);
    const isCutShort = data !== undefined && data.truncated && draft < data.floor;
    const isChanged = Math.abs(draft - label.threshold) > STEP / 2;

    return (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">Similarity threshold</p>
                <p className="text-sm tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{formatThreshold(draft)}</span>
                    {!label.threshold_is_custom && !isChanged && ' · from the examples'}
                </p>
            </div>
            <Slider
                min={MIN_THRESHOLD}
                max={1}
                step={STEP}
                value={[draft]}
                onValueChange={([value]) => setDraft(value ?? label.threshold)}
                aria-label="Similarity threshold"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p aria-live="polite" className="text-sm text-muted-foreground">
                    {wouldMatch === null ? (
                        isLoading ? (
                            'Counting…'
                        ) : (
                            'Couldn’t count matches'
                        )
                    ) : (
                        <>
                            <span className="font-medium text-foreground">
                                {isCutShort && 'At least '}
                                {formatImageCount(wouldMatch)}
                            </span>{' '}
                            would match{isChanged && <span> (now {label.match_count})</span>}
                        </>
                    )}
                </p>
                <div className="flex gap-2">
                    {isChanged && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(label.threshold)} disabled={setThreshold.isPending}>
                            Reset
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        disabled={!isChanged || setThreshold.isPending}
                        onClick={() => setThreshold.mutate({ id: label.id, threshold: Math.round(draft * 100) / 100 })}
                    >
                        {setThreshold.isPending ? 'Applying…' : 'Apply'}
                    </Button>
                </div>
            </div>
            {setThreshold.isError && (
                <p role="alert" className="text-sm text-destructive">
                    Couldn’t apply the threshold. Try again in a moment.
                </p>
            )}
        </div>
    );
}
