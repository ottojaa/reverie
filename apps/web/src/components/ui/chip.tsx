import { cn } from '@/lib/utils';

interface ChipProps {
    children: React.ReactNode;
    /** `taught` marks a tag a taught label put there (dashed outline) rather than one that was typed or generated. */
    variant?: 'primary' | 'secondary' | 'taught';
    className?: string;
    /** When provided, the chip renders as a button (e.g. to filter search by its value). */
    onClick?: () => void;
    title?: string;
}

const VARIANT_STYLES = {
    primary: 'bg-primary/10 text-primary',
    secondary: 'border border-border/50 bg-secondary text-secondary-foreground',
    taught: 'items-center gap-1 border border-dashed border-primary/50 bg-primary/5 text-primary',
} as const;

const VARIANT_HOVER = { primary: 'hover:bg-primary/20', secondary: 'hover:bg-secondary/70', taught: 'hover:bg-primary/15' } as const;

export function Chip({ children, variant = 'primary', className, onClick, title }: ChipProps) {
    const base = cn('inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium', VARIANT_STYLES[variant]);

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
                VARIANT_HOVER[variant],
                className,
            )}
        >
            {children}
        </button>
    );
}
