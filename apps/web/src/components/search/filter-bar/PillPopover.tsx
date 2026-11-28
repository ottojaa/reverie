import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ChevronDown, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { PANEL_EASE, pillBaseClass, pillStateClass } from './pill-style';
import { ReadMark } from './ReadMark';

interface PillPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    icon: typeof ChevronDown;
    label: string;
    title?: string | undefined;
    isActive: boolean;
    /** The filter was read from the words typed, not picked. */
    isRead?: boolean;
    clearLabel: string;
    onClear: () => void;
    children: ReactNode;
}

/** A filter pill that opens its panel, with a clear button while the filter is set. */
export function PillPopover({ open, onOpenChange, icon: Icon, label, title, isActive, isRead, clearLabel, onClear, children }: PillPopoverProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" title={title} className={cn(pillBaseClass, pillStateClass(isActive, open))}>
                    <Icon className="size-3.5 shrink-0" />
                    <span className="max-w-48 truncate">{label}</span>
                    {isRead && <ReadMark />}
                    {isActive ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label={clearLabel}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onOpenChange(false);
                                onClear();
                            }}
                            className="-mr-1 flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
                        >
                            <X className="size-3" />
                        </span>
                    ) : (
                        <ChevronDown className="size-3 shrink-0 opacity-60" />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-64 overflow-hidden rounded-xl border-border/50 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
            >
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: PANEL_EASE }}>
                    {children}
                </motion.div>
            </PopoverContent>
        </Popover>
    );
}
