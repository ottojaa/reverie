import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoFrameStrip } from './useVideoFrameStrip';

const MIN_TRIM_DURATION = 0.5;

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);

    return `${m}:${s.toString().padStart(2, '0')}`;
}

interface VideoTrimTimelineProps {
    duration: number;
    start: number;
    end: number;
    currentTime: number;
    onRangeChange: (start: number, end: number) => void;
    onSeek?: (time: number) => void;
    /** Called when dragging a handle - seek video to align playhead with handle */
    onSeekToHandle?: (time: number) => void;
    /** Video URL for frame strip extraction (optional) */
    videoUrl?: string;
    /** Called when drag starts/ends - parent can ignore timeupdate during drag */
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
    isPlaying = false,
    className,
}: VideoTrimTimelineProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState<'in' | 'out' | null>(null);
    const dragPreviewRef = useRef<{ start: number; end: number } | null>(null);
    const lastFlushedRef = useRef<{ start: number; end: number } | null>(null);
    const { frames, isLoading } = useVideoFrameStrip(videoUrl ?? '', duration);

    const clamp = useCallback((value: number) => Math.max(0, Math.min(duration, value)), [duration]);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent, handle: 'in' | 'out') => {
            e.preventDefault();
            setDragging(handle);
            onDraggingChange?.(true);
            e.currentTarget.setPointerCapture(e.pointerId);
            const sp = (start / duration) * 100;
            const ep = (end / duration) * 100;
            trackRef.current?.style.setProperty('--start-pct', String(sp));
            trackRef.current?.style.setProperty('--end-pct', String(ep));
        },
        [duration, start, end, onDraggingChange],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!trackRef.current || dragging === null) return;

            const rect = trackRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const time = clamp(x * duration);

            if (dragging === 'in') {
                const newStart = clamp(time);
                const newEnd = Math.max(newStart + MIN_TRIM_DURATION, end);
                const preview = { start: newStart, end: newEnd };

                dragPreviewRef.current = preview;
                onRangeChange(newStart, newEnd);
                onSeekToHandle?.(newStart);
                const sp = (newStart / duration) * 100;
                const ep = (newEnd / duration) * 100;
                trackRef.current.style.setProperty('--start-pct', String(sp));
                trackRef.current.style.setProperty('--end-pct', String(ep));
            } else {
                const newEnd = clamp(time);
                const newStart = Math.min(newEnd - MIN_TRIM_DURATION, start);
                const preview = { start: newStart, end: newEnd };

                dragPreviewRef.current = preview;
                onRangeChange(newStart, newEnd);
                onSeekToHandle?.(newEnd);
                const sp = (newStart / duration) * 100;
                const ep = (newEnd / duration) * 100;
                trackRef.current.style.setProperty('--start-pct', String(sp));
                trackRef.current.style.setProperty('--end-pct', String(ep));
            }
        },
        [dragging, duration, end, start, onRangeChange, onSeekToHandle, clamp],
    );

    const handlePointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (trackRef.current && dragging !== null) {
                const rect = trackRef.current.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const time = clamp(x * duration);

                if (dragging === 'in') {
                    const newStart = clamp(time);
                    const newEnd = Math.max(newStart + MIN_TRIM_DURATION, end);

                    lastFlushedRef.current = { start: newStart, end: newEnd };
                    onRangeChange(newStart, newEnd);
                } else {
                    const newEnd = clamp(time);
                    const newStart = Math.min(newEnd - MIN_TRIM_DURATION, start);

                    lastFlushedRef.current = { start: newStart, end: newEnd };
                    onRangeChange(newStart, newEnd);
                }
            }

            e.currentTarget.releasePointerCapture(e.pointerId);
            dragPreviewRef.current = null;
            setDragging(null);
        },
        [dragging, duration, end, start, onRangeChange, clamp],
    );

    const handleTrackClick = useCallback(
        (e: React.MouseEvent) => {
            if (!trackRef.current || !onSeek) return;

            const rect = trackRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const time = clamp(x * duration);

            onSeek(time);
        },
        [duration, onSeek, clamp],
    );

    useEffect(() => {
        const handleGlobalPointerUp = () => {
            const preview = dragPreviewRef.current;

            if (preview) {
                lastFlushedRef.current = { start: preview.start, end: preview.end };
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

    // Notify parent when dragging ends - after commit so range state has flushed
    useEffect(() => {
        if (!dragging) {
            onDraggingChange?.(false);
        }
    }, [dragging, onDraggingChange]);

    // Sync CSS vars from props only when NOT dragging - prevents React re-renders (e.g. timeupdate)
    // from overwriting our direct DOM updates during drag. Use lastFlushedRef when we just released
    // so we don't overwrite with stale props before parent has re-rendered.
    useEffect(() => {
        if (!dragging && trackRef.current) {
            const sp = (start / duration) * 100;
            const ep = (end / duration) * 100;

            trackRef.current.style.setProperty('--start-pct', String(sp));
            trackRef.current.style.setProperty('--end-pct', String(ep));
        }
    }, [dragging, start, end, duration]);

    if (duration <= 0 || !Number.isFinite(duration)) return null;

    const currentPercent = (currentTime / duration) * 100;

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
                    {/* Inner clip: frames, overlays, playhead only - use CSS vars for instant drag updates */}
                    <div className={cn('absolute inset-0 overflow-hidden rounded-lg', dragging && 'transition-none')}>
                        {/* Frame strip or solid fallback */}
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

                        {/* Non-trim overlay: dark mask on left (0 to start) - full opacity */}
                        <div
                            className={cn(
                                'pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/40',
                                !dragging && 'transition-[width] duration-75',
                            )}
                            style={{ width: 'calc(var(--start-pct) * 1%)' }}
                        />

                        {/* Non-trim overlay: dark mask on right (end to 100%) - full opacity */}
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

                        {/* Trim area border - both handles overlay it via -translate-x-1/2 */}
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

                        {/* Playhead - pointer-events none so it does not block handles */}
                        <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-warning" style={{ left: `${currentPercent}%` }} />
                    </div>

                    {/* In handle - outside inner clip so it can overflow */}
                    <div
                        className="absolute top-0 bottom-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-l-md border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                        style={{ left: 'calc(var(--start-pct) * 1%)' }}
                        onPointerDown={(e) => handlePointerDown(e, 'in')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                    >
                        <GripVertical className="size-3.5 shrink-0" />
                    </div>

                    {/* Out handle - -translate-x-1/2 overlays trim like left handle */}
                    <div
                        className="absolute top-0 bottom-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-r-md border-2 border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                        style={{ left: 'calc(var(--end-pct) * 1%)' }}
                        onPointerDown={(e) => handlePointerDown(e, 'out')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                    >
                        <GripVertical className="size-3.5 shrink-0" />
                    </div>
                </div>
            </div>
        </div>
    );
}
