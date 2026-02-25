import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface MinimizedPillProps {
    icon: ReactNode;
    label: string;
    subtitle?: string;
    progress?: number;
    onClick: () => void;
    onClose?: () => void;
    className?: string;
}

export function MinimizedPill({ icon, label, subtitle, progress, onClick, onClose, className }: MinimizedPillProps) {
    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={onClick}
            className={cn(
                'fixed bottom-6 right-12 z-100 flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg ring-1 ring-black/5 transition-shadow hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                className,
            )}
        >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&>svg]:size-4">{icon}</span>
            <div className="flex min-w-0 flex-col items-start text-left">
                <span className="truncate text-sm font-medium text-foreground">{label}</span>
                {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
            </div>
            {typeof progress === 'number' && progress < 100 && (
                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                    <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={false}
                        animate={{ width: `${progress}%` }}
                        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                    />
                </div>
            )}
            {onClose && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="ml-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Close"
                >
                    <X className="size-3.5" />
                </button>
            )}
        </motion.button>
    );
}
