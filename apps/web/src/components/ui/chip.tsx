import { cn } from '@/lib/utils';

interface ChipProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary';
    className?: string;
    /** When provided, the chip renders as a button (e.g. to filter search by its value). */
    onClick?: () => void;
    title?: string;
}

export function Chip({ children, variant = 'primary', className, onClick, title }: ChipProps) {
    const base = cn(
        'inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        variant === 'primary' ? 'bg-primary/10 text-primary' : 'border border-border/50 bg-secondary text-secondary-foreground',
    );

    if (!onClick) {
        return (
            <span className={cn(base, className)} title={title}>
                {children}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={cn(
                base,
                'cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                variant === 'primary' ? 'hover:bg-primary/20' : 'hover:bg-secondary/70',
                className,
            )}
        >
            {children}
        </button>
    );
}
