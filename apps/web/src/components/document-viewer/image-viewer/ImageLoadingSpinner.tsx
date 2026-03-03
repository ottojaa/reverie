import { motion } from 'motion/react';

export function ImageLoadingSpinner() {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="absolute inset-0 z-10 flex items-center justify-center"
            aria-label="Loading image"
        >
            <div className="relative">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="size-8 rounded-full border-2 border-muted-foreground/20 border-t-primary"
                />
                <motion.div
                    animate={{ opacity: [0.25, 0.6, 0.25] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute inset-0 -m-2 rounded-full bg-primary/15"
                />
            </div>
        </motion.div>
    );
}
