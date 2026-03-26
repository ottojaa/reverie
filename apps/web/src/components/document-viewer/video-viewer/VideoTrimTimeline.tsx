import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoFrameStrip } from './useVideoFrameStrip';

const MIN_TRIM_DURATION = 0.5;

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);

    return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Map client X to [0,1] along track; returns null if layout is invalid. */
function pointerXToNormalized(clientX: number, rect: DOMRect): number | null {
    const w = rect.width;

    if (!Number.isFinite(w) || w <= 0) return null;

    const x = (clientX - rect.left) / w;

    return Math.max(0, Math.min(1, x));
}

function computeTrimFromPointer(x: number, duration: number, handle: 'in' | 'out', currentStart: number, currentEnd: number): { start: number; end: number } {
    const time = Math.max(0, Math.min(duration, x * duration));

    if (handle === 'in') {
        const newStart = time;
        const newEnd = Math.max(newStart + MIN_TRIM_DURATION, currentEnd);

        return { start: newStart, end: Math.min(newEnd, duration) };
    }

    const newEnd = time;
    const newStart = Math.max(0, Math.min(newEnd - MIN_TRIM_DURATION, currentStart));

    return { start: newStart, end: newEnd };
}

/** Enforce 0 <= start <= end <= duration and minimum trim width. */
function clampTrimRange(start: number, end: number, duration: number): { start: number; end: number } {
    if (!Number.isFinite(duration) || duration <= 0) {
        return { start: 0, end: 0 };
    }

    let s = Math.max(0, Math.min(start, duration));
    let e = Math.max(0, Math.min(end, duration));

    if (e < s) {
        [s, e] = [e, s];
    }

    if (e - s < MIN_TRIM_DURATION) {
        e = Math.min(duration, s + MIN_TRIM_DURATION);

        if (e - s < MIN_TRIM_DURATION) {
            s = Math.max(0, e - MIN_TRIM_DURATION);
        }
    }

    return { start: s, end: e };
}

function updateTrackCSS(track: HTMLDivElement | null, start: number, end: number, duration: number): void {
    if (!track) return;

    if (!Number.isFinite(duration) || duration <= 0) return;

    const sp = (start / duration) * 100;
    const ep = (end / duration) * 100;

    if (!Number.isFinite(sp) || !Number.isFinite(ep)) return;

    track.style.setProperty('--start-pct', String(sp));
    track.style.setProperty('--end-pct', String(ep));
}

interface VideoTrimTimelineProps {
    duration: number;
    start: number;
    end: number;
    currentTime: number;
    onRangeChange: (start: number, end: number) => void;
    onSeek?: (time: number) => void;
    onSeekToHandle?: (time: number) => void;
    videoUrl?: string;
    onDraggingChange?: (dragging: boolean) => void;
    isPlaying?: boolean;
    className?: string;
}

export function VideoTrimTimeline({
    duration,
    start,
    end,
    currentTime,
    onRangeChange,
    onSeek,
    onSeekToHandle,
    videoUrl,
    onDraggingChange,
    className,
}: VideoTrimTimelineProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState<'in' | 'out' | null>(null);
    const dragPreviewRef = useRef<{ start: number; end: number } | null>(null);

    const { frames, isLoading } = useVideoFrameStrip(videoUrl ?? '', duration);

    const clamp = useCallback((value: number) => Math.max(0, Math.min(duration, value)), [duration]);

    const applyTrim = useCallback(
        (x: number, seekToHandle: boolean) => {
            if (!trackRef.current || dragging === null) return;

            const raw = computeTrimFromPointer(x, duration, dragging, start, end);
            const { start: newStart, end: newEnd } = clampTrimRange(raw.start, raw.end, duration);

            dragPreviewRef.current = { start: newStart, end: newEnd };
            onRangeChange(newStart, newEnd);

            if (seekToHandle) {
                onSeekToHandle?.(dragging === 'in' ? newStart : newEnd);
            }

            updateTrackCSS(trackRef.current, newStart, newEnd, duration);
        },
        [dragging, duration, start, end, onRangeChange, onSeekToHandle],
    );

    const handlePointerDown = useCallback(
        (e: React.PointerEvent, handle: 'in' | 'out') => {
            e.preventDefault();
            setDragging(handle);
            onDraggingChange?.(true);
            e.currentTarget.setPointerCapture(e.pointerId);

            updateTrackCSS(trackRef.current, start, end, duration);
        },
        [duration, start, end, onDraggingChange],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!trackRef.current || dragging === null) return;

            const rect = trackRef.current.getBoundingClientRect();
            const xNorm = pointerXToNormalized(e.clientX, rect);

            if (xNorm === null) return;

            applyTrim(xNorm, true);
        },
        [dragging, applyTrim],
    );

    const handlePointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (trackRef.current && dragging !== null) {
                const rect = trackRef.current.getBoundingClientRect();
                const xNorm = pointerXToNormalized(e.clientX, rect);

                if (xNorm !== null) {
                    applyTrim(xNorm, false);
                }
            }

            e.currentTarget.releasePointerCapture(e.pointerId);

            dragPreviewRef.current = null;
            setDragging(null);
        },
        [dragging, applyTrim],
    );

    const handlePointerCancel = useCallback((e: React.PointerEvent) => {
        try {
            if (e.currentTarget instanceof HTMLElement && e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            // ignore
        }

        dragPreviewRef.current = null;
        setDragging(null);
    }, []);

    const handleTrackClick = useCallback(
        (e: React.MouseEvent) => {
            if (!trackRef.current || !onSeek) return;

            const rect = trackRef.current.getBoundingClientRect();
            const xNorm = pointerXToNormalized(e.clientX, rect);

            if (xNorm === null) return;

            const time = clamp(xNorm * duration);

            onSeek(time);
        },
        [duration, onSeek, clamp],
    );

    useEffect(() => {
        const handleGlobalPointerUp = () => {
            const preview = dragPreviewRef.current;

            if (preview) {
                onRangeChange(preview.start, preview.end);
                dragPreviewRef.current = null;
            }

            setDragging(null);
        };

        if (dragging) {
            window.addEventListener('pointerup', handleGlobalPointerUp);
        }

        return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
    }, [dragging, onRangeChange]);

    useEffect(() => {
        if (!dragging) {
            onDraggingChange?.(false);
        }
    }, [dragging, onDraggingChange]);

    useEffect(() => {
        if (!dragging) {
            updateTrackCSS(trackRef.current, start, end, duration);
        }
    }, [dragging, start, end, duration]);

    if (duration <= 0 || !Number.isFinite(duration)) return null;

    const currentPercent = (currentTime / duration) * 100;

    const handleClassName =
        'absolute top-0 bottom-0 z-10 flex w-4 -translate-x-1/2 touch-none cursor-ew-resize items-center justify-center border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90';

    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    In: {formatTime(start)} · Out: {formatTime(end)} · Duration: {formatTime(end - start)}
                </span>
                <span>Current: {formatTime(currentTime)}</span>
            </div>

            <div className="px-4">
                <div
                    ref={trackRef}
                    role="slider"
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={currentTime}
                    tabIndex={0}
                    className="relative h-18 cursor-pointer overflow-visible rounded-lg bg-muted"
                    onClick={handleTrackClick}
                >
                    <div className={cn('absolute inset-0 overflow-hidden rounded-lg', dragging && 'transition-none')}>
                        {frames.length > 0 ? (
                            <div className="absolute inset-0 flex gap-0.5 rounded-lg">
                                {frames.map((src, i) => (
                                    <div key={i} className="h-full flex-1 shrink-0 bg-cover bg-center" style={{ backgroundImage: `url(${src})` }} />
                                ))}
                            </div>
                        ) : (
                            <div className="absolute inset-0 rounded-lg bg-muted" />
                        )}

                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/80">
                                <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            </div>
                        )}

                        <div
                            className={cn(
                                'pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/40',
                                !dragging && 'transition-[width] duration-75',
                            )}
                            style={{ width: 'calc(var(--start-pct) * 1%)' }}
                        />

                        <div
                            className={cn(
                                'pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/40',
                                !dragging && 'transition-[left,width] duration-75',
                            )}
                            style={{
                                left: 'calc(var(--end-pct) * 1%)',
                                width: 'calc((100 - var(--end-pct)) * 1%)',
                            }}
                        />

                        <div
                            className={cn(
                                'pointer-events-none absolute inset-y-0 rounded-md border-4 border-primary z-1',
                                !dragging && 'transition-[left,width] duration-75',
                            )}
                            style={{
                                left: 'calc(var(--start-pct) * 1%)',
                                width: 'calc((var(--end-pct) - var(--start-pct)) * 1%)',
                            }}
                        />

                        <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-warning" style={{ left: `${currentPercent}%` }} />
                    </div>

                    <div
                        className={cn(handleClassName, 'rounded-l-md')}
                        style={{ left: 'calc(var(--start-pct) * 1%)' }}
                        onPointerDown={(e) => handlePointerDown(e, 'in')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                    >
                        <GripVertical className="size-3.5 shrink-0" />
                    </div>

                    <div
                        className={cn(handleClassName, 'rounded-r-md')}
                        style={{ left: 'calc(var(--end-pct) * 1%)' }}
                        onPointerDown={(e) => handlePointerDown(e, 'out')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                    >
                        <GripVertical className="size-3.5 shrink-0" />
                    </div>
                </div>
            </div>
        </div>
    );
}
