import { API_BASE } from '@/lib/api/client';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoEditorPanel, getInitialVideoEditorState } from '../VideoEditorPanel';
import type { ViewerProps } from '../viewer-registry';
import { VideoTrimTimeline } from './VideoTrimTimeline';
import { useVideoSave } from './useVideoSave';

export function VideoEditMode({ document, fileUrl, onToggleEdit }: ViewerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const isDraggingRef = useRef(false);
    const hasInitializedRef = useRef(false);
    const [duration, setDuration] = useState(0);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [editorState, setEditorState] = useState(() => getInitialVideoEditorState(document));

    const posterUrl = document.thumbnail_urls?.lg ? `${API_BASE}${document.thumbnail_urls.lg}` : undefined;

    const handleRangeChange = useCallback((newStart: number, newEnd: number) => {
        setStart(newStart);
        setEnd(newEnd);
    }, []);

    const handleSeek = useCallback((time: number) => {
        const video = videoRef.current;

        if (video) {
            video.currentTime = time;
            setCurrentTime(time);
        }
    }, []);

    const handleDraggingChange = useCallback((dragging: boolean) => {
        isDraggingRef.current = dragging;
    }, []);

    useEffect(() => {
        hasInitializedRef.current = false;
    }, [fileUrl]);

    useEffect(() => {
        const video = videoRef.current;

        if (!video) return;

        const onLoadedMetadata = () => {
            const d = video.duration;

            if (Number.isFinite(d) && d > 0) {
                setDuration(d);
                setEnd(d);
                hasInitializedRef.current = true;
            }
        };

        const onTimeUpdate = () => {
            if (isDraggingRef.current) return;

            const t = video.currentTime;

            setCurrentTime(t);

            if (t >= end) {
                video.pause();
            }
        };

        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('timeupdate', onTimeUpdate);

        if (video.readyState >= 1 && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            onLoadedMetadata();
        }

        return () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('timeupdate', onTimeUpdate);
        };
    }, [end, fileUrl]);

    const { handleSave, isSaving } = useVideoSave({
        document,
        start,
        end,
        saveAsCopy: editorState.saveAsCopy,
        onToggleEdit,
    });

    return (
        <div className="flex h-full w-full flex-col overflow-hidden px-4 pb-4 pt-14 md:px-6 md:pb-6 md:pt-14">
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[1fr_380px] gap-4">
                <div className="flex min-h-0 min-w-0 flex-col gap-3">
                    <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg">
                        <video
                            ref={videoRef}
                            src={fileUrl}
                            poster={posterUrl}
                            controls
                            controlsList="nodownload"
                            playsInline
                            preload="metadata"
                            className="max-h-full max-w-full rounded-lg object-contain"
                        />
                    </div>

                    <div className="shrink-0 p-2">
                        <VideoTrimTimeline
                            duration={duration}
                            start={start}
                            end={end}
                            currentTime={currentTime}
                            onRangeChange={handleRangeChange}
                            onSeek={handleSeek}
                            onSeekToHandle={handleSeek}
                            onDraggingChange={handleDraggingChange}
                            videoUrl={fileUrl}
                        />
                    </div>
                </div>

                <AnimatePresence>
                    <VideoEditorPanel
                        document={document}
                        state={editorState}
                        onStateChange={(updates) => setEditorState((s) => ({ ...s, ...updates }))}
                        onCancel={() => onToggleEdit?.()}
                        onSave={handleSave}
                        isSaving={isSaving}
                    />
                </AnimatePresence>
            </div>
        </div>
    );
}
