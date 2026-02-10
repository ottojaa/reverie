import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import type { ViewerProps } from './viewer-registry';

export default function VideoViewer({ document, fileUrl }: ViewerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isReady, setIsReady] = useState(false);

    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const posterUrl = document.thumbnail_urls?.lg ? `${API_BASE}${document.thumbnail_urls.lg}` : undefined;

    return (
        <div className="flex h-full w-full items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{
                    opacity: isReady ? 1 : 0.3,
                    scale: isReady ? 1 : 0.97,
                }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="max-h-full max-w-full"
            >
                <video
                    ref={videoRef}
                    src={fileUrl}
                    poster={posterUrl}
                    controls
                    controlsList="nodownload"
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={() => setIsReady(true)}
                    onCanPlay={() => setIsReady(true)}
                    className="max-h-[calc(100vh-8rem)] max-w-full rounded-lg shadow-2xl"
                />
            </motion.div>
        </div>
    );
}
