import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@reverie/shared';
import { Calendar, ChevronDown, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { DateFilterPanel, type DateFieldKey, type DateFieldState } from './DateFilterPanel';
import { PANEL_EASE, pillBaseClass, pillStateClass } from './FilterPill';

interface DateFilterPillProps extends DateFieldState {
    onSetValue: (key: DateFieldKey, value: string) => void;
    onClearField: (key: DateFieldKey) => void;
    /** Clears both date fields in a single navigation (two sequential clears would race). */
    onClearAll: () => void;
}

function dateLabel({ uploadedValue, dateValue }: DateFieldState): string {
    if (!uploadedValue && !dateValue) return 'Date';

    const primary = uploadedValue ? `Uploaded: ${formatDateRange(uploadedValue)}` : `Doc date: ${formatDateRange(dateValue ?? '')}`;

    return uploadedValue && dateValue ? `${primary} +1` : primary;
}

/** The single Date pill covering both date fields (uploaded / document date). */
export function DateFilterPill({ uploadedValue, dateValue, onSetValue, onClearField, onClearAll }: DateFilterPillProps) {
    const [open, setOpen] = useState(false);
    const isActive = uploadedValue !== null || dateValue !== null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" className={cn(pillBaseClass, pillStateClass(isActive, open))}>
                    <Calendar className="size-3.5 shrink-0" />
                    <span className="max-w-48 truncate">{dateLabel({ uploadedValue, dateValue })}</span>
                    {isActive ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label="Clear date filters"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setOpen(false);
                                onClearAll();
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
                    <DateFilterPanel
                        uploadedValue={uploadedValue}
                        dateValue={dateValue}
                        onSetValue={onSetValue}
                        onClear={onClearField}
                        onDone={() => setOpen(false)}
                    />
                </motion.div>
            </PopoverContent>
        </Popover>
    );
}
