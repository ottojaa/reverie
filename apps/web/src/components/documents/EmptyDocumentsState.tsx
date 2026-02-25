import { Upload } from 'lucide-react';
import { motion } from 'motion/react';

export interface EmptyDocumentsStateProps {
    isFolderView: boolean;
}

const container = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1, delayChildren: 0.15 },
    },
};

const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export function EmptyDocumentsState({ isFolderView }: EmptyDocumentsStateProps) {
    return (
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-1 items-center justify-center">
            <div className="relative w-full max-w-md">
                {/* Breathing dashed drop-zone border */}
                <motion.div
                    className="absolute inset-0 rounded-2xl border-[1.5px] border-dashed border-muted-foreground/20"
                    animate={{ opacity: [0.4, 0.8, 0.4] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                />

                {/* Subtle center glow */}
                <div
                    className="pointer-events-none absolute inset-0 rounded-2xl"
                    style={{
                        background: `radial-gradient(ellipse 70% 55% at 50% 45%, color-mix(in oklch, var(--primary) 5%, transparent), transparent)`,
                    }}
                />

                <motion.div variants={item} className="relative flex flex-col items-center px-8 py-16 text-center">
                    {/* Floating upload icon */}
                    <motion.div
                        variants={item}
                        animate={{ y: [0, -5, 0] }}
                        transition={{
                            duration: 3.5,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0.6,
                        }}
                    >
                        <div className="mb-8 flex size-14 items-center justify-center rounded-xl border border-border/50 bg-muted/40 shadow-sm">
                            <Upload className="size-6 text-primary/60" strokeWidth={1.5} />
                        </div>
                    </motion.div>

                    <motion.h2 variants={item} className="text-lg font-medium tracking-tight text-foreground/90">
                        {isFolderView ? 'Drop files here' : 'Drop files to get started'}
                    </motion.h2>

                    <motion.p variants={item} className="mt-2.5 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
                        Drag files into this area, or use the upload &nbsp;
                        <Upload className="size-2.5 inline-block" />
                        &nbsp;button on the bottom right
                    </motion.p>

                    {!isFolderView && (
                        <motion.p variants={item} className="mt-10 text-xs tracking-wide text-muted-foreground/50">
                            Organize your files with collections from the sidebar
                        </motion.p>
                    )}
                </motion.div>
            </div>
        </motion.div>
    );
}
