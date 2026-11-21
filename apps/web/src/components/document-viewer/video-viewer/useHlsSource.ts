import type Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AUTO_QUALITY, isTokenRefusal, toQualityLevels, toSetKey, type QualityLevel } from './hls-playback';

const NATIVE_HLS_TYPE = 'application/vnd.apple.mpegurl';

/** Sign-again attempts in a row before the original takes over (reset once a segment plays). */
const MAX_TOKEN_REFRESHES = 2;

type Playback = { kind: 'pending' } | { kind: 'hls' } | { kind: 'native'; src: string } | { kind: 'original' };

interface Resume {
    at: number;
    playing: boolean;
}

interface PlayerEvents {
    onLevels: (levels: QualityLevel[]) => void;
    onLevelSwitched: (index: number) => void;
    onTokenRefused: () => void;
    onSegmentPlayed: () => void;
    onFatal: () => void;
}

interface UseHlsSourceOptions {
    videoRef: RefObject<HTMLVideoElement | null>;
    /** The master playlist URL, or null when the video has no renditions (it then plays the original). */
    hlsUrl: string | null;
    originalUrl: string;
    /** Signs the set again (a refetch of the document); null when it cannot. */
    refreshHlsUrl: () => Promise<string | null>;
}

function openPlayer(HlsClass: typeof Hls, video: HTMLVideoElement, url: string, wanted: number, resume: Resume | null, events: PlayerEvents): Hls {
    const hls = new HlsClass({ startPosition: resume?.at ?? -1 });

    hls.on(HlsClass.Events.MANIFEST_PARSED, (_event, data) => {
        events.onLevels(toQualityLevels(data.levels));

        if (wanted >= 0 && wanted < data.levels.length) hls.currentLevel = wanted;

        if (resume?.playing) void video.play().catch(() => undefined);
    });
    hls.on(HlsClass.Events.LEVEL_SWITCHED, (_event, data) => events.onLevelSwitched(data.level));
    hls.on(HlsClass.Events.FRAG_BUFFERED, events.onSegmentPlayed);
    hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (isTokenRefusal(data.response?.code)) return events.onTokenRefused();

        if (data.fatal) events.onFatal();
    });
    hls.loadSource(url);
    hls.attachMedia(video);

    return hls;
}

/** What the `<video>` carries as `src`: hls.js attaches its own while it plays, so then (and while deciding) nothing. */
function toSrc(setKey: string | null, playback: Playback, originalUrl: string): string | undefined {
    if (!setKey || playback.kind === 'original') return originalUrl;

    return playback.kind === 'native' ? playback.src : undefined;
}

/**
 * Plays a video's HLS renditions in `videoRef`: hls.js where the browser has Media Source Extensions, the browser's own
 * HLS where it has only that, the original file otherwise (or when the renditions fail). Returns the `src` the
 * `<video>` must carry (undefined while hls.js owns it) and the rungs to choose between.
 */
export function useHlsSource({ videoRef, hlsUrl, originalUrl, refreshHlsUrl }: UseHlsSourceOptions) {
    const setKey = toSetKey(hlsUrl);
    const [playback, setPlayback] = useState<Playback>({ kind: 'pending' });
    const [levels, setLevels] = useState<QualityLevel[]>([]);
    const [selected, setSelected] = useState(AUTO_QUALITY);
    const [playingLevel, setPlayingLevel] = useState(AUTO_QUALITY);
    const hlsRef = useRef<Hls | null>(null);
    const selectedRef = useRef(AUTO_QUALITY);

    // A refetch signs the set again; the effect below must not restart playback for it, so it reads these at start only.
    const latest = useRef({ hlsUrl, refreshHlsUrl });

    latest.current = { hlsUrl, refreshHlsUrl };

    useEffect(() => {
        const video = videoRef.current;
        const startUrl = latest.current.hlsUrl;

        setLevels([]);
        setPlayingLevel(AUTO_QUALITY);

        if (!setKey || !startUrl || !video) return setPlayback({ kind: 'original' });

        setPlayback({ kind: 'pending' });

        let disposed = false;
        let refreshes = 0;
        let refreshing = false;

        const fallBack = () => {
            hlsRef.current?.destroy();
            hlsRef.current = null;
            setLevels([]);
            setPlayback({ kind: 'original' });
        };

        const start = (HlsClass: typeof Hls, url: string, resume: Resume | null) => {
            hlsRef.current = openPlayer(HlsClass, video, url, selectedRef.current, resume, {
                onLevels: setLevels,
                onLevelSwitched: setPlayingLevel,
                onSegmentPlayed: () => (refreshes = 0),
                onFatal: fallBack,
                onTokenRefused: () => void refreshToken(HlsClass),
            });
        };

        // The token ran out mid-playback (a paused tab, a long watch): sign the set again and carry on from here.
        const refreshToken = async (HlsClass: typeof Hls) => {
            if (refreshing || disposed) return;

            if (refreshes >= MAX_TOKEN_REFRESHES) return fallBack();

            refreshing = true;
            refreshes += 1;

            const resume = { at: video.currentTime, playing: !video.paused };
            const fresh = await latest.current.refreshHlsUrl().catch(() => null);

            refreshing = false;

            if (disposed) return;

            if (!fresh) return fallBack();

            hlsRef.current?.destroy();
            start(HlsClass, fresh, resume);
        };

        void import('hls.js').then(({ default: HlsClass }) => {
            if (disposed) return;

            if (HlsClass.isSupported()) {
                setPlayback({ kind: 'hls' });

                return start(HlsClass, startUrl, null);
            }

            setPlayback(video.canPlayType(NATIVE_HLS_TYPE) ? { kind: 'native', src: startUrl } : { kind: 'original' });
        }, fallBack);

        return () => {
            disposed = true;
            hlsRef.current?.destroy();
            hlsRef.current = null;
        };
    }, [setKey, videoRef]);

    const selectQuality = useCallback((index: number) => {
        selectedRef.current = index;
        setSelected(index);

        if (hlsRef.current) hlsRef.current.currentLevel = index;
    }, []);

    const playingLabel = levels.find((level) => level.index === playingLevel)?.label ?? null;
    const src = toSrc(setKey, playback, originalUrl);

    return { src, levels, selected, playingLabel, selectQuality };
}
