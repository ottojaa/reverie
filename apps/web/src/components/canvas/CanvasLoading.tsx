import { motion } from 'motion/react';

/** Suspense fallback while the three.js scene chunk streams in. */
export function CanvasLoading() {
    return (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-col items-center gap-4">
                <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Preparing canvas...</p>
            </motion.div>
        </div>
    );
}
