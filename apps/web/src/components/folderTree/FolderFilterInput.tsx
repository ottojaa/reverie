import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

/** Filters the folder tree by name. Escape and the clear button empty it. */
export function FolderFilterInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const hasQuery = value.trim().length > 0;

    return (
        <div role="search" className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80" aria-hidden />
            <Input
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;

                    e.preventDefault();
                    onChange('');
                }}
                placeholder="Filter your folders"
                aria-label="Filter folders"
                className={cn(
                    'h-8 rounded-lg border-sidebar-border/80 bg-sidebar-accent/30 pl-9 text-sm shadow-none transition-colors',
                    'placeholder:text-muted-foreground/70',
                    'focus-visible:bg-sidebar-accent/50 focus-visible:border-sidebar-border',
                    hasQuery && 'pr-9',
                )}
            />
            <AnimatePresence>
                {hasQuery && (
                    <motion.div
                        key="clear"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                    >
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                            aria-label="Clear filter"
                            onClick={() => onChange('')}
                        >
                            <X className="size-3.5" />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
