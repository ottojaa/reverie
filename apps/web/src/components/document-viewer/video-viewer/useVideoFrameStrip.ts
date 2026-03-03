import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_FRAME_COUNT = 10;

/**
 * Extracts video frames at evenly spaced timestamps for timeline thumbnails.
 * Uses canvas + video.currentTime + seeked event. No external libraries.
 */
export function useVideoFrameStrip(videoUrl: string, duration: number, frameCount = DEFAULT_FRAME_COUNT): { frames: string[]; isLoading: boolean } {
    const [frames, setFrames] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const abortRef = useRef(false);

    const extractFrames = useCallback(async () => {
        if (!videoUrl || videoUrl.length === 0 || duration <= 0 || !Number.isFinite(duration)) return;

        abortRef.current = false;
        setIsLoading(true);
        setFrames([]);

        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.display = 'none';
        document.body.appendChild(video);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            document.body.removeChild(video);
            setIsLoading(false);

            return;
        }

        const result: string[] = [];

        const loadAndSeek = (): Promise<void> =>
            new Promise((resolve, reject) => {
                video.onloadeddata = () => resolve();
                video.onerror = () => reject(new Error('Video load failed'));
                video.src = videoUrl;
            });

        try {
            await loadAndSeek();

            if (abortRef.current) return;

            const count = Math.min(frameCount, Math.max(1, Math.floor(duration)));

            console.log({ frameCount, duration, count });
            const times: number[] = [];

            for (let i = 0; i < count; i++) {
                times.push((i / (count - 1 || 1)) * duration);
            }

            for (let i = 0; i < times.length; i++) {
                if (abortRef.current) break;

                const t = times[i];

                await new Promise<void>((resolve) => {
                    const onSeeked = () => {
                        video.removeEventListener('seeked', onSeeked);
                        video.removeEventListener('error', onError);

                        try {
                            const w = video.videoWidth;
                            const h = video.videoHeight;

                            if (w > 0 && h > 0) {
                                canvas.width = w;
                                canvas.height = h;
                                ctx.drawImage(video, 0, 0, w, h);
                                result.push(canvas.toDataURL('image/jpeg', 0.7));
                            }
                        } catch {
                            // CORS or canvas error - skip frame
                        }

                        resolve();
                    };

                    const onError = () => {
                        video.removeEventListener('seeked', onSeeked);
                        video.removeEventListener('error', onError);
                        resolve();
                    };

                    video.addEventListener('seeked', onSeeked);
                    video.addEventListener('error', onError);
                    video.currentTime = t ?? 0;
                });
            }

            if (!abortRef.current) {
                setFrames(result);
            }
        } catch {
            // Silently fail - fallback to solid background
        } finally {
            document.body.removeChild(video);
            setIsLoading(false);
        }
    }, [videoUrl, duration, frameCount]);

    useEffect(() => {
        extractFrames();

        return () => {
            abortRef.current = true;
        };
    }, [extractFrames]);

    return { frames, isLoading };
}
