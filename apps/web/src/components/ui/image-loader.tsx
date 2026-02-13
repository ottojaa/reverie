import { AnimatePresence, motion, useInView } from 'motion/react';
import { useEffect, useState } from 'react';
import { Blurhash } from 'react-blurhash';

const isCached = (src: string) => {
    const img = new Image();
    img.src = src;

    return img.complete || img.width + img.height > 0;
};

interface ImageLoaderProps {
    ref: React.RefObject<HTMLDivElement | null>;
    hash: string;
    url: string;
    containerStyle?: React.CSSProperties;
    style?: React.CSSProperties;
    borderRadius?: number;
    loadEager?: boolean;
}

/**
 * Show the image's blurhash (if any) before the image is loaded
 * If loadEager is set to false, the image will be loaded after it's visible in the viewport (instead of just in the DOM).
 */
export const ImageLoader: React.FC<ImageLoaderProps> = ({ ref, hash, url, containerStyle, style, borderRadius = 0, loadEager = false }) => {
    const [loaded, setLoaded] = useState(isCached(url));
    const inView = useInView(ref);

    useEffect(() => {
        const setImageUrl = () => {
            const img = new Image();

            img.onload = () => {
                setLoaded(true);
            };

            img.src = url;
        };

        if (!loaded && (inView || loadEager)) {
            setImageUrl();
        }
    }, [inView, loaded, url, loadEager]);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative', ...containerStyle }}>
            {hash ? (
                <AnimatePresence>
                    {(loadEager || loaded || inView) && <motion.img key="main" src={url} style={{ ...style, overflow: 'hidden', borderRadius }} />}
                    {!loaded && (
                        <motion.div
                            style={{ ...style, position: 'absolute', top: 0, borderRadius }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4, ease: 'easeInOut' }}
                        >
                            <Blurhash hash={hash} width="100%" height="100%" resolutionX={32} resolutionY={32} punch={0} />
                        </motion.div>
                    )}
                </AnimatePresence>
            ) : (
                <motion.img key="main" src={url} style={{ ...style, borderRadius }} />
            )}
        </div>
    );
};
