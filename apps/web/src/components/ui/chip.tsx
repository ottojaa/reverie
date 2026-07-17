import { cn } from '@/lib/utils';

interface ChipProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary';
    className?: string;
}

export function Chip({ children, variant = 'primary', className }: ChipProps) {
    return (
        <span
            className={cn(
                'inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                variant === 'primary' ? 'bg-primary/10 text-primary' : 'border border-border/50 bg-secondary text-secondary-foreground',
                className,
            )}
        >
            {children}
        </span>
    );
}
