import { cn } from '@/lib/utils';

export const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

export const pillBaseClass =
    'h-7 shrink-0 gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50';

// The dark:hover overrides beat Button ghost's `dark:hover:bg-accent/50` (indigo), which
// twMerge can't dedupe against a plain `hover:bg-*` (different variant stacks).
export function pillStateClass(isActive: boolean, isOpen = false): string {
    if (isActive) {
        return cn('border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15', isOpen && 'bg-primary/15');
    }

    return cn(
        'border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
        isOpen && 'bg-secondary text-foreground',
    );
}
